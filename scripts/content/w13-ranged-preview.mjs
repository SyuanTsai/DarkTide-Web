import { createHash } from 'node:crypto';
import { lstat, readFile, readdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import {
  assertWebAuthoringSchemaParity,
  getReviewState,
  loadWebAuthoringInputs,
  validateWebAuthoring,
} from './contract-authoring.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CANDIDATE_RELATIVE = 'content/contracts/w13/ranged-candidate';
const LOCK_RELATIVE = CANDIDATE_RELATIVE + '/candidate-lock.json';
const SOURCE_SCHEMA_PATH = 'content/contracts/w07/source-v2-snapshot/content/schema/v2/source-contract.schema.json';
const SOURCE_VALIDATOR_PATH = 'content/contracts/w07/source-v2-snapshot/scripts/content/contract-validator.mjs';
const APPROVED_BASELINE_PATH = 'content/contracts/w09/authoring-overlays/w07/authoring/7c2e8bba7b53629af1a7938b5b47108054290a76fbf322b3a7d47f56d4977dd6.json';
const APPROVED_W06_PATH = 'content/contracts/w09/authoring-overlays/w06/authoring/5e6ce454a13636c36d53b287bf150785fceb5022bc6f35d3cdab92d3d8a6ee3b.json';
const SELECTED_W09_PATH = 'content/contracts/w09/source-handoff/selected.json';
const SELECTED_W09_LOCK_PATH = 'content/contracts/w09/source-handoff/locks/0c18b1e4f18392982efa0d54ad23f4f8e2758cf42780fb0019b6b15a565c1578.json';
const EXPECTED_CANDIDATE_FILES = Object.freeze([
  'authoring.json',
  'official-inputs.json',
  'official-locale-evidence.json',
  'source-cache/analysis.md',
  'source-cache/public-code-closure.json',
  'source-cache/selected-composition.json',
  'source-cache/source-contract.json',
  'source-cache/source-manifest.json',
  'source-cache/source-receipt.json',
  'source-cache/source-revision.json',
  'source-cache/source-revision.md',
  'source-cache/technical.json',
]);
const EXPECTED_NEW_TARGET_PATHS = Object.freeze([
  '/official',
  '/name',
  '/weaponView/markLabel',
  '/weaponView/attackHeading',
  '/weaponView/comparisonHeading',
  '/weaponView/note',
  '/weaponView/attackProfileRefs/0',
  '/weaponView/attackProfileRefs/1',
]);
const SHA256_RE = /^[a-f0-9]{64}$/u;
const SHA1_RE = /^[a-f0-9]{40}$/u;
const canonicalJson = value => Array.isArray(value)
  ? '[' + value.map(canonicalJson).join(',') + ']'
  : value && typeof value === 'object'
    ? '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonicalJson(value[key])).join(',') + '}'
    : JSON.stringify(value);
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const sourceRecordKey = row => String(row.gameReleaseId) + '\0' + String(row.recordId);
const fail = message => { throw new Error('W13 ranged candidate: ' + message); };

function parseJson(bytes, label) {
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { fail(label + ' is not valid UTF-8'); }
  try { return JSON.parse(text); }
  catch (error) { fail(label + ' is not valid JSON: ' + error.message); }
}

function requireSha(value, label, expression = SHA256_RE) {
  if (typeof value !== 'string' || !expression.test(value)) fail(label + ' is not a lowercase digest');
}

function exactKeys(value, expected, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(label + ' must be an object');
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (!isDeepStrictEqual(actual, wanted)) fail(label + ' has an unexpected property set');
}

function expectedSourcePin(lock) {
  return {
    repository: lock.source.repository,
    commit: lock.source.commit,
    schemaId: lock.source.schemaId,
    schemaSha256: lock.source.sourceSchemaSha256,
    dataSha256: lock.source.sourceDataSha256,
    validatorSha256: lock.source.sourceValidatorSha256,
  };
}

async function walkFiles(directory, relative = '') {
  const output = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const child = relative ? relative + '/' + entry.name : entry.name;
    if (entry.isSymbolicLink()) fail('candidate cache contains a symbolic link: ' + child);
    if (entry.isDirectory()) output.push(...await walkFiles(path.join(directory, entry.name), child));
    else if (entry.isFile()) output.push(child);
    else fail('candidate cache contains a non-file entry: ' + child);
  }
  return output.sort();
}

async function readCandidateFiles(candidateRoot, lock) {
  if (!Array.isArray(lock.files)) fail('candidate lock file pins must be an array');
  const rows = [...lock.files].sort((left, right) => String(left.path).localeCompare(String(right.path), 'en'));
  if (!isDeepStrictEqual(rows.map(row => row.path), EXPECTED_CANDIDATE_FILES)) fail('candidate lock file set differs from the fixed W13 cache set');
  const files = new Map();
  for (const row of rows) {
    exactKeys(row, ['path', 'sizeBytes', 'sha256'], 'candidate file pin');
    requireSha(row.sha256, 'candidate file SHA-256');
    if (!Number.isSafeInteger(row.sizeBytes) || row.sizeBytes < 1) fail('candidate file size is invalid: ' + row.path);
    const absolute = path.resolve(candidateRoot, ...row.path.split('/'));
    const relative = path.relative(candidateRoot, absolute);
    if (!relative || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) fail('candidate file path escapes its cache');
    const metadata = await lstat(absolute);
    if (!metadata.isFile() || metadata.isSymbolicLink()) fail('candidate file is not a regular file: ' + row.path);
    const bytes = await readFile(absolute);
    if (bytes.byteLength !== row.sizeBytes || sha256(bytes) !== row.sha256) fail('candidate file bytes differ from their lock: ' + row.path);
    files.set(row.path, bytes);
  }
  const actualFiles = await walkFiles(candidateRoot);
  const expectedFiles = ['candidate-lock.json', ...EXPECTED_CANDIDATE_FILES].sort();
  if (!isDeepStrictEqual(actualFiles, expectedFiles)) fail('candidate directory contains missing or unpinned files');
  return files;
}

function validateCandidateLock(lock) {
  exactKeys(lock, [
    'schema', 'status', 'selected', 'previewOnly', 'fixtureOnly', 'publicationEligible', 'candidate', 'source',
    'officialLocale', 'web', 'sourceSchemaAndValidatorAreReusedFromPinnedW07Cache', 'files',
  ], 'candidate lock');
  if (lock.schema !== 'w13-ranged-web-candidate-lock/1' || lock.status !== 'pending' || lock.selected !== false
    || lock.previewOnly !== true || lock.fixtureOnly !== false || lock.publicationEligible !== false
    || lock.sourceSchemaAndValidatorAreReusedFromPinnedW07Cache !== true) {
    fail('candidate must remain unselected, non-fixture, and non-publishable');
  }
  exactKeys(lock.candidate, [
    'weaponId', 'gameReleaseId', 'webPresentationId', 'oldApprovedW07Overlay', 'approvedW06Overlay',
    'selectedW09Request', 'webTargetCount',
  ], 'candidate identity');
  if (lock.candidate.weaponId !== 'lasgun_p1_m1' || lock.candidate.gameReleaseId !== 'darktide:1.13.2'
    || lock.candidate.webPresentationId !== 'web:presentation:lasgun-p1-m1' || lock.candidate.webTargetCount !== 8) {
    fail('candidate identity differs from the fixed ranged representative');
  }
  exactKeys(lock.candidate.oldApprovedW07Overlay, ['path', 'sha256', 'targetCount', 'receiptCount'], 'approved W07 baseline identity');
  if (lock.candidate.oldApprovedW07Overlay.path !== APPROVED_BASELINE_PATH
    || lock.candidate.oldApprovedW07Overlay.targetCount !== 38 || lock.candidate.oldApprovedW07Overlay.receiptCount !== 38) {
    fail('immutable W07 approved baseline identity differs');
  }
  requireSha(lock.candidate.oldApprovedW07Overlay.sha256, 'approved W07 overlay SHA-256');
  exactKeys(lock.candidate.approvedW06Overlay, ['path', 'sha256', 'targetCount', 'receiptCount', 'presentationCount'], 'approved W06 baseline identity');
  if (lock.candidate.approvedW06Overlay.path !== APPROVED_W06_PATH || lock.candidate.approvedW06Overlay.sha256 !== 'e4cea874d9215448f65011b08e9a2a23ad900f31fa30c220d63a4731b16cb0be'
    || lock.candidate.approvedW06Overlay.targetCount !== 34 || lock.candidate.approvedW06Overlay.receiptCount !== 39
    || lock.candidate.approvedW06Overlay.presentationCount !== 2) {
    fail('immutable W06 approved baseline identity differs');
  }
  exactKeys(lock.candidate.selectedW09Request, [
    'selectedPath', 'selectedCommit', 'selectedSha256', 'selectedSnapshotPath', 'requestId', 'lockPath', 'lockSha256',
  ], 'selected W09 request identity');
  if (lock.candidate.selectedW09Request.selectedPath !== SELECTED_W09_PATH
    || lock.candidate.selectedW09Request.selectedCommit !== 'ab5b5b336e4d0501b8b1fd8eda21b60178e64cb9'
    || lock.candidate.selectedW09Request.selectedSnapshotPath !== 'source-cache/selected-composition.json'
    || lock.candidate.selectedW09Request.requestId !== '0c18b1e4f18392982efa0d54ad23f4f8e2758cf42780fb0019b6b15a565c1578'
    || lock.candidate.selectedW09Request.lockPath !== SELECTED_W09_LOCK_PATH) {
    fail('selected W09 composition request identity differs');
  }
  for (const field of ['selectedSha256', 'lockSha256']) requireSha(lock.candidate.selectedW09Request[field], 'selected W09 ' + field);

  exactKeys(lock.source, [
    'repository', 'commit', 'schemaId', 'upstreamPublicCodeRepository', 'upstreamPublicCodeCommit', 'gameReleaseId',
    'sourceDataPath', 'sourceDataSha256', 'sourceSchemaPath', 'sourceSchemaSha256', 'sourceValidatorPath',
    'sourceValidatorSha256', 'candidateTechnicalSha256', 'sourceRevision', 'sourceManifestSha256',
    'sourceReceiptFileSha256', 'sourceReceiptDigest', 'sourceBuildIdentityVerified', 'sourcePublicationEligible',
    'sourceRawClosureFileCount', 'sourceRawClosureBytes',
  ], 'Source candidate identity');
  if (lock.source.repository !== 'https://github.com/SyuanTsai/DarkTide-Source-Data'
    || lock.source.commit !== '980a32bd620bf4456ddbc3fbd1a9a6453a11f426'
    || lock.source.schemaId !== 'https://github.com/SyuanTsai/DarkTide-Source-Data/content/schema/v2/source-contract.schema.json'
    || lock.source.upstreamPublicCodeRepository !== 'https://github.com/Aussiemon/Darktide-Source-Code'
    || lock.source.upstreamPublicCodeCommit !== 'ba6c148f3c2768ca3ce20d846a12e56e2f433f3e'
    || lock.source.gameReleaseId !== lock.candidate.gameReleaseId
    || lock.source.sourceDataPath !== 'content/authoring/v2/w07-weapons.json'
    || lock.source.sourceSchemaPath !== SOURCE_SCHEMA_PATH || lock.source.sourceValidatorPath !== SOURCE_VALIDATOR_PATH
    || lock.source.sourceBuildIdentityVerified !== true || lock.source.sourcePublicationEligible !== false
    || lock.source.sourceRawClosureFileCount !== 16 || lock.source.sourceRawClosureBytes !== 244937) {
    fail('fixed Source owner, packet, or raw closure metadata differs');
  }
  for (const [key, value] of Object.entries(lock.source)) {
    if (key.endsWith('Sha256') || key.endsWith('Digest')) requireSha(value, 'Source candidate ' + key);
  }
  requireSha(lock.source.sourceRevision, 'Source revision');
  exactKeys(lock.officialLocale, ['sourceBatch', 'sourceExcerptFileSha256', 'selectedKeys'], 'official locale evidence pin');
  if (lock.officialLocale.sourceBatch !== 'w04-25681127-20261018-9449f844838349d381c159226c56333b'
    || !isDeepStrictEqual(lock.officialLocale.selectedKeys, ['loc_weapon_family_lasgun_p1_m1'])) {
    fail('official locale evidence scope differs from the fixed W04 family entry');
  }
  requireSha(lock.officialLocale.sourceExcerptFileSha256, 'official excerpt source SHA-256');
  exactKeys(lock.web, ['authoringSha256', 'officialInputsSha256', 'officialLocaleEvidenceSha256', 'authoringContainsNoNewSyntheticReviewReceipts'], 'Web candidate pin');
  if (lock.web.authoringContainsNoNewSyntheticReviewReceipts !== true) fail('candidate receipt statement is invalid');
  for (const field of ['authoringSha256', 'officialInputsSha256', 'officialLocaleEvidenceSha256']) requireSha(lock.web[field], 'Web candidate ' + field);
}

function verifyPublicCodeClosure(value, lock) {
  exactKeys(value, ['schema', 'repository', 'commit', 'gameReleaseId', 'fixtureOnly', 'publicationEligible', 'fileCount', 'rawBytes', 'files'], 'public code closure cache');
  if (value.schema !== 'w13-public-code-closure-cache/1' || value.repository !== lock.source.upstreamPublicCodeRepository
    || value.commit !== lock.source.upstreamPublicCodeCommit || value.gameReleaseId !== lock.source.gameReleaseId
    || value.fixtureOnly !== false || value.publicationEligible !== false || value.fileCount !== 16
    || value.rawBytes !== 244937 || !Array.isArray(value.files) || value.files.length !== 16) {
    fail('pinned public-code closure identity or size differs');
  }
  const seen = new Set();
  let totalBytes = 0;
  for (const row of value.files) {
    exactKeys(row, ['path', 'gitBlobSha1', 'sizeBytes', 'sha256', 'bytesBase64'], 'public-code raw input row');
    requireSha(row.sha256, 'public-code raw input SHA-256');
    requireSha(row.gitBlobSha1, 'public-code Git blob SHA-1', SHA1_RE);
    if (typeof row.path !== 'string' || row.path.includes('..') || seen.has(row.path)
      || !Number.isSafeInteger(row.sizeBytes) || row.sizeBytes < 1 || typeof row.bytesBase64 !== 'string') {
      fail('public-code raw input row identity is invalid');
    }
    seen.add(row.path);
    const bytes = Buffer.from(row.bytesBase64, 'base64');
    if (bytes.toString('base64') !== row.bytesBase64 || bytes.byteLength !== row.sizeBytes || sha256(bytes) !== row.sha256) {
      fail('public-code raw input bytes differ from their pins: ' + row.path);
    }
    const gitBlob = createHash('sha1').update(Buffer.concat([Buffer.from('blob ' + bytes.byteLength + '\0', 'utf8'), bytes])).digest('hex');
    if (gitBlob !== row.gitBlobSha1) fail('public-code raw input Git blob differs: ' + row.path);
    totalBytes += bytes.byteLength;
  }
  if (totalBytes !== lock.source.sourceRawClosureBytes) fail('public-code raw input total size differs');
}

function verifyWebCandidate(authoring, officialInputs, localeEvidence, overlay, lock) {
  if (authoring.fixtureOnly !== false || authoring.publicationEligible !== false || authoring.officialInputsSha256 !== lock.web.officialInputsSha256
    || officialInputs.fixtureOnly !== false || officialInputs.publicationEligible !== false) {
    fail('Web authoring or official input is not the fixed non-publishable contract');
  }
  if (!Array.isArray(overlay.reviewTargets) || !Array.isArray(overlay.reviewReceipts)
    || overlay.reviewTargets.length !== 38 || overlay.reviewReceipts.length !== 38
    || !isDeepStrictEqual(authoring.reviewTargets.filter(target => overlay.reviewTargets.some(old => old.targetId === target.targetId)), overlay.reviewTargets)
    || !isDeepStrictEqual(authoring.reviewReceipts.filter(receipt => overlay.reviewTargets.some(old => old.targetId === receipt.targetId)), overlay.reviewReceipts)) {
    fail('the existing 38 approved Web targets or receipts changed');
  }
  const presentation = authoring.presentations.find(row => row.authoringId === lock.candidate.webPresentationId);
  if (!presentation || presentation.entityRef.gameReleaseId !== lock.candidate.gameReleaseId
    || presentation.entityRef.recordId !== 'darktide:weapon:lasgun:p1-m1' || presentation.entityRef.kind !== 'weapon') {
    fail('ranged Web presentation is missing or has the wrong Source identity');
  }
  const newTargets = authoring.reviewTargets.filter(target => target.ownerId === lock.candidate.webPresentationId);
  if (newTargets.length !== 8 || !isDeepStrictEqual(newTargets.map(target => target.fieldPath).sort(), [...EXPECTED_NEW_TARGET_PATHS].sort())) {
    fail('ranged Web review targets differ from the exact eight authorized fields');
  }
  const newTargetIds = new Set(newTargets.map(target => target.targetId));
  const newReceipts = authoring.reviewReceipts.filter(receipt => newTargetIds.has(receipt.targetId));
  for (const receipt of newReceipts) {
    const reviewer = receipt.reviewer;
    if (reviewer?.kind !== 'human' || typeof reviewer.id !== 'string' || !reviewer.id.trim()
      || /(?:^|[-_:])(?:synthetic|probe|fixture|test-only)(?:[-_:]|$)/iu.test(reviewer.id)) {
      fail('new W13 review receipt is not a non-test human receipt');
    }
  }
  if (localeEvidence.schema !== 'w13-ranged-official-locale-evidence/1' || localeEvidence.fixtureOnly !== false
    || localeEvidence.publicationEligible !== false || localeEvidence.reviewState !== 'pending'
    || localeEvidence.gameReleaseId !== lock.candidate.gameReleaseId || localeEvidence.gameBuild !== '25681127'
    || localeEvidence.sourceBatch !== lock.officialLocale.sourceBatch
    || localeEvidence.sourceExcerptFileSha256 !== lock.officialLocale.sourceExcerptFileSha256) {
    fail('official locale evidence identity differs from its safe excerpt pin');
  }
  const excerptKeys = ['locale', 'sourceHash', 'occurrence', 'entryIndex', 'sourceText', 'sourceTextSha256', 'rawExportSha256'];
  if (!Array.isArray(localeEvidence.selectedExcerpts) || localeEvidence.selectedExcerpts.length !== 2) fail('official locale evidence must contain only the English and Traditional Chinese family excerpt');
  const excerptByLocale = new Map(localeEvidence.selectedExcerpts.map(row => [row.locale, row]));
  for (const [locale, expectedText, expectedEntry] of [['en', 'Infantry Lasgun', 12917], ['zh-TW', '步兵鐳射槍', 12913]]) {
    const row = excerptByLocale.get(locale);
    if (!row || row.key !== 'loc_weapon_family_lasgun_p1_m1' || row.sourceText !== expectedText
      || row.entryIndex !== expectedEntry || row.sourceHash !== 'f93eef0d' || row.occurrence !== 1
      || !excerptKeys.every(key => row[key] !== undefined)) fail('official family excerpt changed for ' + locale);
    const officialRow = officialInputs.sources.find(source => source.entityRef?.recordId === presentation.entityRef.recordId
      && source.sourceLocale === locale && source.key === row.key);
    if (!officialRow || officialRow.sourceText !== row.sourceText || officialRow.sourceHash !== row.sourceHash
      || officialRow.occurrence !== row.occurrence) fail('Web official input differs from its fixed locale excerpt for ' + locale);
  }
  return { presentation, newTargets, newReceipts };
}

function verifyApprovedW06Overlay(overlay, lock, selected, selectedLock) {
  const pin = lock.candidate.approvedW06Overlay;
  if (!Array.isArray(overlay.presentations) || overlay.presentations.length !== pin.presentationCount
    || !Array.isArray(overlay.reviewTargets) || overlay.reviewTargets.length !== pin.targetCount
    || !Array.isArray(overlay.reviewReceipts) || overlay.reviewReceipts.length !== pin.receiptCount
    || selected.schema !== 'w09-selected-composition/1'
    || !selected.proposals?.some(row => row.requestId === lock.candidate.selectedW09Request.requestId && row.gameReleaseId === lock.candidate.gameReleaseId)) {
    fail('selected W06 approved overlay or its selected-composition reference is invalid');
  }
  const selectedW06 = selectedLock.authoringOverlay?.find(row => row.mode === 'w06' && row.target === 'authoring');
  const selectedW07 = selectedLock.authoringOverlay?.find(row => row.mode === 'w07' && row.target === 'authoring');
  if (!selectedW06 || selectedW06.path !== pin.path || selectedW06.sha256 !== pin.sha256
    || !selectedW07 || selectedW07.path !== lock.candidate.oldApprovedW07Overlay.path
    || selectedW07.sha256 !== lock.candidate.oldApprovedW07Overlay.sha256) {
    fail('W06/W07 overlays do not match the selected immutable W09 request lock');
  }
}

function verifySelectedW09Snapshot(selected, selectedLock, lock, selectedSnapshotBytes) {
  const request = lock.candidate.selectedW09Request;
  if (sha256(selectedSnapshotBytes) !== request.selectedSha256 || selected.schema !== 'w09-selected-composition/1'
    || !selected.proposals?.some(row => row.requestId === request.requestId && row.gameReleaseId === lock.candidate.gameReleaseId)) {
    fail('cached selected W09 snapshot differs from its historical pin');
  }
  const selectedW06 = selectedLock.authoringOverlay?.find(row => row.mode === 'w06' && row.target === 'authoring');
  const selectedW07 = selectedLock.authoringOverlay?.find(row => row.mode === 'w07' && row.target === 'authoring');
  if (!selectedW06 || selectedW06.path !== lock.candidate.approvedW06Overlay.path
    || selectedW06.sha256 !== lock.candidate.approvedW06Overlay.sha256
    || !selectedW07 || selectedW07.path !== lock.candidate.oldApprovedW07Overlay.path
    || selectedW07.sha256 !== lock.candidate.oldApprovedW07Overlay.sha256) {
    fail('cached selected W09 snapshot and immutable request lock disagree on authoring overlays');
  }
}

export async function readW13SelectedW09Snapshot({ repoRoot = REPO_ROOT, candidateRoot } = {}) {
  const absoluteRepoRoot = await realpath(repoRoot);
  const absoluteCandidateRoot = await realpath(candidateRoot ?? path.join(absoluteRepoRoot, ...CANDIDATE_RELATIVE.split('/')));
  const { lock } = await readCandidateLock(absoluteCandidateRoot);
  const request = lock.candidate.selectedW09Request;
  const [selectedSnapshotBytes, selectedLockBytes] = await Promise.all([
    readFile(path.join(absoluteCandidateRoot, ...request.selectedSnapshotPath.split('/'))),
    readFile(path.join(absoluteRepoRoot, ...request.lockPath.split('/'))),
  ]);
  if (sha256(selectedLockBytes) !== request.lockSha256) fail('immutable historical W09 request lock changed');
  const selected = parseJson(selectedSnapshotBytes, 'cached selected W09 snapshot');
  const selectedLock = parseJson(selectedLockBytes, 'immutable W09 request lock');
  verifySelectedW09Snapshot(selected, selectedLock, lock, selectedSnapshotBytes);
  return { selected, selectedLock, selectedSha256: sha256(selectedSnapshotBytes), selectedLockSha256: sha256(selectedLockBytes) };
}

function verifySourcePacket(sourceData, technical, manifest, receipt, revision, files, lock) {
  if (sourceData.schemaVersion !== '2.0.0' || sourceData.contractKind !== 'source-technical'
    || sourceData.fixtureOnly !== false || sourceData.publicationEligible !== false
    || technical.schemaVersion !== '2.0.0' || technical.contractKind !== 'source-technical'
    || technical.fixtureOnly !== false || technical.publicationEligible !== false) {
    fail('Source owner contract and candidate packet must be real non-publishable contracts');
  }
  if (manifest.schema !== 'w05-source-manifest/1' || manifest.mode !== 'candidate'
    || manifest.sourceRevision !== lock.source.sourceRevision || manifest.buildIdentity?.verified !== true
    || sha256(files.get('source-cache/source-manifest.json')) !== lock.source.sourceManifestSha256) {
    fail('original W09 candidate Source manifest identity differs');
  }
  if (receipt.schema !== 'w05-source-build-receipt/1' || receipt.mode !== 'candidate' || receipt.previewOnly !== true
    || receipt.publicationEligible !== false || receipt.buildIdentityVerified !== true
    || receipt.sourceRevision !== manifest.sourceRevision || receipt.manifestSha256 !== lock.source.sourceManifestSha256
    || receipt.receiptSha256 !== lock.source.sourceReceiptDigest || receipt.validation?.result !== 'valid'
    || receipt.validation?.publicationEligible !== false) {
    fail('original W09 Source receipt must remain verified and non-publishable');
  }
  if (revision.schema !== 'w05-source-revision/2' || revision.mode !== 'candidate' || revision.sourceRevision !== manifest.sourceRevision) {
    fail('Source revision summary differs from the fixed candidate revision');
  }
  const packetFiles = new Map([
    ['analysis.md', files.get('source-cache/analysis.md')],
    ['source-revision.json', files.get('source-cache/source-revision.json')],
    ['source-revision.md', files.get('source-cache/source-revision.md')],
    ['technical.json', files.get('source-cache/technical.json')],
  ]);
  if (!Array.isArray(manifest.files) || manifest.files.length !== packetFiles.size) fail('Source manifest packet file list differs');
  for (const row of manifest.files) {
    const bytes = packetFiles.get(row.path);
    if (!bytes || !Number.isSafeInteger(row.sizeBytes) || row.sizeBytes !== bytes.byteLength || row.sha256 !== sha256(bytes)) {
      fail('Source manifest packet file bytes differ: ' + row.path);
    }
  }
  const w13RecordPredicate = record => (record.sourceRefs ?? []).some(ref => String(ref.sourceId).startsWith('public-code:w13-lasgun-p1-m1-'));
  const dataRecords = new Map(sourceData.records.filter(w13RecordPredicate).map(record => [sourceRecordKey(record), record]));
  const packetRecords = new Map(technical.records.filter(w13RecordPredicate).map(record => [sourceRecordKey(record), record]));
  if (dataRecords.size !== 9 || packetRecords.size !== 9 || dataRecords.size !== packetRecords.size) fail('Source owner and W09 candidate do not contain the fixed nine W13 records');
  for (const [key, record] of dataRecords) if (!isDeepStrictEqual(record, packetRecords.get(key))) fail('Source W13 record differs between owner and candidate packet: ' + key.replaceAll('\0', ':'));
  const targetCount = [...packetRecords.values()].reduce((sum, record) => sum + (record.reviewTargets?.length ?? 0), 0);
  if (targetCount !== 26) fail('Source W13 review target count differs from the fixed 26 targets');
}

async function readCandidateLock(candidateRoot) {
  const lockPath = path.join(candidateRoot, 'candidate-lock.json');
  const metadata = await lstat(lockPath);
  if (!metadata.isFile() || metadata.isSymbolicLink()) fail('candidate lock is not a regular file');
  const bytes = await readFile(lockPath);
  const lock = parseJson(bytes, 'candidate-lock.json');
  validateCandidateLock(lock);
  return { bytes, lock };
}

async function loadW08BaselinePins(repoRoot) {
  const inputLockPath = 'content/contracts/w08/compiler-inputs.lock.json';
  const compilerLockPath = 'content/contracts/w08/compiler.lock.json';
  const [inputBytes, compilerBytes] = await Promise.all([
    readFile(path.join(repoRoot, ...inputLockPath.split('/'))),
    readFile(path.join(repoRoot, ...compilerLockPath.split('/'))),
  ]);
  const inputLock = parseJson(inputBytes, inputLockPath);
  const compilerLock = parseJson(compilerBytes, compilerLockPath);
  if (inputLock.schemaVersion !== 'w08-compiler-inputs/1' || compilerLock.schemaVersion !== 'w08-compiler/1'
    || !Array.isArray(inputLock.inputFiles) || !Array.isArray(compilerLock.files)) {
    fail('existing W08 baseline/compiler lock shape is invalid');
  }
  return {
    loadStatus: 'raw-locks-observed-only',
    candidateCompilationStatus: 'not-run',
    reason: 'The Root will refresh and verify the normal W08 locks after the final Web code SHA; this pure loader does not invent compiler provenance.',
    inputLockPath,
    inputLockSha256: sha256(inputBytes),
    compilerLockPath,
    compilerLockSha256: sha256(compilerBytes),
    authoringCommit: inputLock.authoringCommit,
    gameReleaseId: inputLock.gameReleaseId,
    proposedContentVersion: inputLock.proposedContentVersion,
    baselineSource: {
      repository: inputLock.source.repository,
      commit: inputLock.source.commit,
      sourceRevision: inputLock.source.sourceRevision,
      manifestSha256: inputLock.source.manifestSha256,
    },
    compilerCommit: compilerLock.commit,
    compilerFiles: compilerLock.files.map(row => ({ path: row.path, sizeBytes: row.sizeBytes, sha256: row.sha256 })),
  };
}

export async function loadW13RangedPreviewInputs({ repoRoot = REPO_ROOT, candidateRoot } = {}) {
  const absoluteRepoRoot = await realpath(repoRoot);
  const absoluteCandidateRoot = await realpath(candidateRoot ?? path.join(absoluteRepoRoot, ...CANDIDATE_RELATIVE.split('/')));
  const { bytes: lockBytes, lock } = await readCandidateLock(absoluteCandidateRoot);
  const files = await readCandidateFiles(absoluteCandidateRoot, lock);
  const get = (filePath, label = filePath) => {
    const value = files.get(filePath);
    if (!value) fail('candidate omits ' + label);
    return value;
  };
  const authoringBytes = get('authoring.json');
  const officialBytes = get('official-inputs.json');
  const localeBytes = get('official-locale-evidence.json');
  const sourceDataBytes = get('source-cache/source-contract.json');
  const technicalBytes = get('source-cache/technical.json');
  const manifestBytes = get('source-cache/source-manifest.json');
  const receiptBytes = get('source-cache/source-receipt.json');
  const revisionBytes = get('source-cache/source-revision.json');
  const closureBytes = get('source-cache/public-code-closure.json');
  const authoring = parseJson(authoringBytes, 'candidate Web authoring');
  const officialInputs = parseJson(officialBytes, 'candidate Web official inputs');
  const localeEvidence = parseJson(localeBytes, 'candidate official locale evidence');
  const sourceData = parseJson(sourceDataBytes, 'Source owner contract');
  const technical = parseJson(technicalBytes, 'W09 Source candidate technical contract');
  const manifest = parseJson(manifestBytes, 'W09 Source candidate manifest');
  const sourcePacketReceipt = parseJson(receiptBytes, 'W09 Source candidate receipt');
  const revision = parseJson(revisionBytes, 'W09 Source candidate revision');
  const closure = parseJson(closureBytes, 'public-code closure');
  verifySourcePacket(sourceData, technical, manifest, sourcePacketReceipt, revision, files, lock);
  verifyPublicCodeClosure(closure, lock);

  const schemaPath = path.join(absoluteRepoRoot, ...lock.source.sourceSchemaPath.split('/'));
  const validatorPath = path.join(absoluteRepoRoot, ...lock.source.sourceValidatorPath.split('/'));
  const [schemaBytes, validatorBytes] = await Promise.all([readFile(schemaPath), readFile(validatorPath)]);
  if (sha256(schemaBytes) !== lock.source.sourceSchemaSha256 || sha256(validatorBytes) !== lock.source.sourceValidatorSha256) {
    fail('reused Source schema/validator bytes differ from their fixed W07 cache pin');
  }
  const schema = parseJson(schemaBytes, 'pinned Source schema');
  const sourceValidator = await import(pathToFileURL(validatorPath).href);
  if (sourceValidator.CONTRACT_SCHEMA_ID !== lock.source.schemaId) fail('pinned Source validator schema identity differs');
  sourceValidator.assertSchemaValidatorParity(schema);
  const ownerValidation = sourceValidator.validateSourceContract(sourceData, { schema });
  const packetValidation = sourceValidator.validateSourceContract(technical, { schema });
  if (!ownerValidation.valid || !packetValidation.valid) {
    const issues = [...ownerValidation.issues, ...packetValidation.issues].slice(0, 8).map(item => item.path + ' ' + item.message).join('; ');
    fail('pinned Source schema rejected the owner or W09 candidate contract: ' + issues);
  }

  const [baseW06, baseW07] = await Promise.all([
    loadWebAuthoringInputs({ repoRoot: absoluteRepoRoot, mode: 'w06' }),
    loadWebAuthoringInputs({ repoRoot: absoluteRepoRoot, mode: 'w07' }),
  ]);
  const overlayPath = path.join(absoluteRepoRoot, ...lock.candidate.oldApprovedW07Overlay.path.split('/'));
  const overlayBytes = await readFile(overlayPath);
  if (sha256(overlayBytes) !== lock.candidate.oldApprovedW07Overlay.sha256) fail('immutable approved W07 overlay changed');
  const overlay = parseJson(overlayBytes, 'immutable approved W07 overlay');
  const verifiedWeb = verifyWebCandidate(authoring, officialInputs, localeEvidence, overlay, lock);
  const w06OverlayPath = path.join(absoluteRepoRoot, ...lock.candidate.approvedW06Overlay.path.split('/'));
  const selectedLockPath = path.join(absoluteRepoRoot, ...lock.candidate.selectedW09Request.lockPath.split('/'));
  const [w06OverlayBytes, selectedLockBytes] = await Promise.all([
    readFile(w06OverlayPath), readFile(selectedLockPath),
  ]);
  if (sha256(w06OverlayBytes) !== lock.candidate.approvedW06Overlay.sha256
    || sha256(selectedLockBytes) !== lock.candidate.selectedW09Request.lockSha256) {
    fail('selected W06/W09 immutable overlay or request lock bytes differ from the candidate pin');
  }
  const w06Overlay = parseJson(w06OverlayBytes, 'selected W06 approved overlay');
  const selectedBytes = get(lock.candidate.selectedW09Request.selectedSnapshotPath, 'cached selected W09 snapshot');
  const selected = parseJson(selectedBytes, 'cached selected W09 snapshot');
  const selectedLock = parseJson(selectedLockBytes, 'selected W09 input lock');
  verifySelectedW09Snapshot(selected, selectedLock, lock, selectedBytes);
  verifyApprovedW06Overlay(w06Overlay, lock, selected, selectedLock);

  const sourceLock = {
    schemaVersion: '1.0.0',
    repository: lock.source.repository,
    commit: lock.source.commit,
    schemaId: lock.source.schemaId,
    files: {
      schema: { path: 'content/schema/v2/source-contract.schema.json', sha256: lock.source.sourceSchemaSha256 },
      data: { path: lock.source.sourceDataPath, sha256: lock.source.sourceDataSha256 },
      validator: { path: 'scripts/content/contract-validator.mjs', sha256: lock.source.sourceValidatorSha256 },
    },
  };
  const sourcePin = expectedSourcePin(lock);
  if (!isDeepStrictEqual(authoring.sourcePin, sourcePin)) fail('candidate Web authoring Source pin differs from its Source owner bytes');
  const officialHash = sha256(officialBytes);
  if (officialHash !== lock.web.officialInputsSha256) fail('candidate official input raw hash differs from the candidate lock');
  const sourceRecordMap = new Map(technical.records.map(record => [sourceRecordKey(record), record]));
  const sourceReleaseMap = new Map(technical.gameReleases.map(release => [release.gameReleaseId, release]));
  const sourcePinForProjection = {
    repository: sourcePin.repository,
    commit: sourcePin.commit,
    schemaId: sourcePin.schemaId,
    schemaSha256: sourcePin.schemaSha256,
    dataSha256: sourcePin.dataSha256,
    validatorSha256: sourcePin.validatorSha256,
  };
  const candidateWebLock = {
    ...baseW07.webLock,
    officialInputs: { path: CANDIDATE_RELATIVE + '/official-inputs.json', sha256: officialHash },
    authoring: { path: CANDIDATE_RELATIVE + '/authoring.json', sha256: sha256(authoringBytes) },
  };
  const makeProjectedMode = (base, modeAuthoring, modeOfficialInputs, webLock) => ({
    ...base,
    mode: base.mode,
    sourceLock,
    sourceContract: technical,
    sourceSchema: schema,
    sourceValidator,
    sourceValidation: packetValidation,
    sourcePin: sourcePinForProjection,
    sourceRecordMap,
    sourceReleaseMap,
    authoring: modeAuthoring,
    officialInputs: modeOfficialInputs,
    webLock,
  });
  const w07Authoring = structuredClone(authoring);
  const w07 = makeProjectedMode(baseW07, w07Authoring, officialInputs, candidateWebLock);
  const w06Authoring = structuredClone(w06Overlay);
  w06Authoring.sourcePin = structuredClone(sourcePinForProjection);
  const w06WebLock = {
    ...baseW06.webLock,
    authoring: { path: lock.candidate.approvedW06Overlay.path, sha256: lock.candidate.approvedW06Overlay.sha256 },
  };
  const w06 = makeProjectedMode(baseW06, w06Authoring, baseW06.officialInputs, w06WebLock);
  const w06Validation = validateWebAuthoring(w06.authoring, w06);
  if (!w06Validation.valid) fail('W06 baseline fails when projected onto the fixed candidate Source contract: ' + w06Validation.issues.slice(0, 8).map(item => item.path + ' ' + item.message).join('; '));
  const w07Validation = validateWebAuthoring(w07.authoring, w07);
  if (!w07Validation.valid) fail('W13 Web candidate fails the existing authoring validator: ' + w07Validation.issues.slice(0, 12).map(item => item.path + ' ' + item.message).join('; '));
  w06.webValidation = w06Validation;
  w07.webValidation = w07Validation;

  const reviewStates = Object.fromEntries(verifiedWeb.newTargets.map(target => [target.targetId, getReviewState(w07.authoring, target.targetId, w07)]));
  const allowedReviewStates = new Set(['pending', 'approved', 'rejected', 'stale']);
  if (Object.values(reviewStates).some(state => !allowedReviewStates.has(state))) fail('candidate review API returned an unsupported review state');
  const w06ReviewStates = w06.authoring.reviewTargets.map(target => getReviewState(w06.authoring, target.targetId, w06));
  if (w06.authoring.reviewTargets.length !== 34 || w06.authoring.reviewReceipts.length !== 39
    || w06ReviewStates.some(state => state !== 'approved')) {
    fail('the selected W06 baseline did not preserve its 34 all-approved review targets and 39 receipts');
  }
  const sourceCachePins = lock.files.filter(row => row.path.startsWith('source-cache/'));
  const sourceCacheSha256 = sha256(Buffer.from(canonicalJson(sourceCachePins), 'utf8'));
  const w08BaselinePins = await loadW08BaselinePins(absoluteRepoRoot);
  const reviewReceipt = {
    schema: 'w13-ranged-candidate-review-receipt/1',
    candidateLockSha256: sha256(lockBytes),
    status: 'validated-pending-candidate',
    previewOnly: true,
    fixtureOnly: false,
    publicationEligible: false,
    candidateSelected: false,
    source: {
      repository: lock.source.repository,
      commit: lock.source.commit,
      gameReleaseId: lock.source.gameReleaseId,
      sourceRevision: lock.source.sourceRevision,
      sourceManifestSha256: lock.source.sourceManifestSha256,
      sourceCacheSha256,
      sourceDataSha256: lock.source.sourceDataSha256,
      candidateTechnicalSha256: lock.source.candidateTechnicalSha256,
      sourcePacketBuildIdentityVerified: sourcePacketReceipt.buildIdentityVerified,
      sourcePacketPublicationEligible: sourcePacketReceipt.publicationEligible,
      publicCodeCommit: lock.source.upstreamPublicCodeCommit,
    },
    web: {
      authoringSha256: lock.web.authoringSha256,
      officialInputsSha256: lock.web.officialInputsSha256,
      officialLocaleEvidenceSha256: lock.web.officialLocaleEvidenceSha256,
      preservedApprovedTargetCount: overlay.reviewTargets.length,
      preservedApprovedReceiptCount: overlay.reviewReceipts.length,
      newTargetCount: verifiedWeb.newTargets.length,
      newReceiptCount: verifiedWeb.newReceipts.length,
      newReviewStates: reviewStates,
    },
    w06Baseline: {
      overlayPath: lock.candidate.approvedW06Overlay.path,
      overlaySha256: lock.candidate.approvedW06Overlay.sha256,
      preservedTargetCount: w06.authoring.reviewTargets.length,
      preservedReceiptCount: w06.authoring.reviewReceipts.length,
      allTargetsApprovedByReviewApi: true,
    },
    selectedW09Snapshot: {
      sourcePath: lock.candidate.selectedW09Request.selectedPath,
      sourceCommit: lock.candidate.selectedW09Request.selectedCommit,
      sourceSha256: lock.candidate.selectedW09Request.selectedSha256,
      selectedW09RequestId: lock.candidate.selectedW09Request.requestId,
      immutableRequestLockSha256: lock.candidate.selectedW09Request.lockSha256,
    },
    w08BaselineCompilerPins: w08BaselinePins,
    projection: {
      method: 'W09 fixed Source candidate packet plus independently validated W07 Web authoring overlay',
      originalSourcePacketBuildIdentityVerified: true,
      compilerSourceBuildIdentity: 'not-projected-in-pure-loader-step',
      compilationStatus: 'not-run',
      note: 'W08 baseline/compiler pins do not yet bind this W13 candidate. Root refreshes and verifies the normal code/schema pins before any compile adapter is authorized.',
    },
  };
  return {
    repoRoot: absoluteRepoRoot,
    candidateRoot: absoluteCandidateRoot,
    candidateLock: lock,
    candidateLockSha256: reviewReceipt.candidateLockSha256,
    sourceData,
    sourceContract: technical,
    sourceSchema: schema,
    sourceValidator,
    sourceValidation: packetValidation,
    sourcePin,
    w06,
    w07,
    reviewReceipt,
  };
}

async function runCli() {
  try {
    const candidate = await loadW13RangedPreviewInputs();
    process.stdout.write(JSON.stringify(candidate.reviewReceipt, null, 2) + '\n');
  } catch (error) {
    process.stderr.write((error?.stack ?? String(error)) + '\n');
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await runCli();
