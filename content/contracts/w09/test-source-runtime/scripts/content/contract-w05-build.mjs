import { createHash, randomUUID } from 'node:crypto';
import { mkdir, lstat, readFile, readdir, rename, rm, rmdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assertSafeJsonValue,
  canonicalJsonString,
  isPlainObject,
  mergeContractDocuments,
  sha256Canonical,
  sortJsonValue
} from './contract-w05-merge.mjs';
import {
  computeReviewDigests,
  loadContractSchema,
  validateSourceContract
} from './contract-validator.mjs';

const DERIVED_ISSUES = new Set(['review-state-mismatch', 'publication-state-mismatch']);
const REGISTRY_NAMES = ['gameReleases', 'sourceSnapshots', 'sourceRefs', 'records', 'tombstones'];
const TICK = String.fromCharCode(96);

function safeError(label, validation) {
  const details = validation.issues.map((issue) => issue.path + ' [' + issue.code + ']').join('; ');
  return label + ' contract validation failed' + (details ? ': ' + details : '');
}

function validateInputDocument(document, label, schema) {
  if (!isPlainObject(document)) throw new Error(label + ' must be a contract object');
  try { assertSafeJsonValue(document, label); }
  catch (error) { throw new Error(label + ' is malformed: ' + error.message); }
  const validation = validateSourceContract(document, { schema });
  const blocking = validation.issues.filter((issue) => !DERIVED_ISSUES.has(issue.code));
  if (blocking.length > 0) {
    throw new Error(safeError(label, { issues: blocking }));
  }
  const neutral = structuredClone(document);
  neutral.publicationEligible = false;
  for (const item of [...neutral.records, ...neutral.tombstones]) {
    const hasReceipt = neutral.reviewReceipts.some((receipt) =>
      receipt.target.gameReleaseId === item.gameReleaseId && receipt.target.recordId === item.recordId);
    if (hasReceipt || item.reviewState !== 'draft') item.reviewState = 'pending';
  }
  return neutral;
}

function receiptKey(target) {
  return JSON.stringify([target.gameReleaseId, target.recordId, target.fieldPath, target.dimension]);
}

function deriveReviewStates(contract) {
  const receipts = new Map(contract.reviewReceipts.map((receipt) => [receiptKey(receipt.target), receipt]));
  for (const item of [...contract.records, ...contract.tombstones]) {
    const priorState = item.reviewState;
    let receiptCount = 0;
    let stale = false;
    let rejected = false;
    let allApproved = item.reviewTargets.length > 0;
    for (const target of item.reviewTargets) {
      const fullTarget = {
        gameReleaseId: item.gameReleaseId,
        recordId: item.recordId,
        fieldPath: target.fieldPath,
        dimension: target.dimension
      };
      const receipt = receipts.get(receiptKey(fullTarget));
      if (!receipt) {
        allApproved = false;
        continue;
      }
      receiptCount += 1;
      try {
        const actual = computeReviewDigests(contract, fullTarget);
        if (actual.targetDigest !== receipt.targetDigest || actual.dependenciesDigest !== receipt.dependenciesDigest) stale = true;
      } catch {
        stale = true;
      }
      if (receipt.decision === 'rejected') rejected = true;
      if (receipt.decision !== 'approved') allApproved = false;
    }
    item.reviewState = stale ? 'stale' : rejected ? 'rejected' : receiptCount === 0 && priorState === 'draft' ? 'draft' : allApproved ? 'approved' : 'pending';
  }
}

function validateMergedContract(contract, schema) {
  deriveReviewStates(contract);
  contract.publicationEligible = false;
  const preliminary = validateSourceContract(contract, { schema });
  contract.publicationEligible = preliminary.publicationEligible;
  const validation = validateSourceContract(contract, { schema });
  if (!validation.valid) throw new Error(safeError('merged', validation));
  return validation;
}

function unverifiedBuildMetadata(contract) {
  const unverified = [];
  const check = (value, label) => {
    if (typeof value !== 'string' || value.trim().length === 0 || value.trim().toUpperCase() === 'UNVERIFIED') {
      unverified.push(label + ' build value ' + JSON.stringify(value));
    }
  };
  for (const release of contract.gameReleases) check(release.gameBuild, 'game release ' + release.gameReleaseId);
  for (const source of contract.sourceRefs) check(source.gameBuild, 'source ' + source.gameReleaseId + ':' + source.sourceId);
  return unverified;
}

function assertVerifiedBuildMetadata(contract) {
  const unverified = unverifiedBuildMetadata(contract);
  if (unverified.length > 0) throw new Error('formal output blocked: ' + unverified.join('; ') + ' must be verified');
}

function compareLexical(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function registryKey(name, item) {
  if (name === 'gameReleases') return JSON.stringify([item.gameReleaseId]);
  if (name === 'sourceSnapshots') return JSON.stringify([item.snapshot.snapshotId]);
  if (name === 'sourceRefs') return JSON.stringify([item.gameReleaseId, item.sourceId]);
  if (name === 'reviewReceipts') return JSON.stringify([
    item.target.gameReleaseId, item.target.recordId, item.target.fieldPath, item.target.dimension
  ]);
  return JSON.stringify([item.gameReleaseId, item.recordId]);
}

function withoutDerivedReviewState(value) {
  const copy = structuredClone(value);
  if (isPlainObject(copy)) delete copy.reviewState;
  return copy;
}

function fieldPaths(before, after, currentPath = '') {
  if (canonicalJsonString(before) === canonicalJsonString(after)) return [];
  if (isPlainObject(before) && isPlainObject(after)) {
    const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort(compareLexical);
    const changed = [];
    for (const key of keys) {
      if (key === 'reviewState') continue;
      const hasBefore = Object.hasOwn(before, key);
      const hasAfter = Object.hasOwn(after, key);
      const childPath = currentPath + '/' + key.replaceAll('~', '~0').replaceAll('/', '~1');
      if (!hasBefore || !hasAfter) changed.push(childPath);
      else changed.push(...fieldPaths(before[key], after[key], childPath));
    }
    return changed;
  }
  return [currentPath || '/'];
}

function registryEntries(contract, name) {
  if (name === 'sourceSnapshots' && !Object.hasOwn(contract, name)) return [];
  return contract[name];
}

function registryDiff(name, baseline, merged) {
  const before = new Map(registryEntries(baseline, name).map((item) => [registryKey(name, item), item]));
  const after = new Map(registryEntries(merged, name).map((item) => [registryKey(name, item), item]));
  const keys = [...new Set([...before.keys(), ...after.keys()])].sort(compareLexical);
  const added = [];
  const removed = [];
  const updated = [];
  for (const key of keys) {
    if (!before.has(key)) added.push(key);
    else if (!after.has(key)) removed.push(key);
    else {
      const oldItem = withoutDerivedReviewState(before.get(key));
      const newItem = withoutDerivedReviewState(after.get(key));
      const fields = fieldPaths(oldItem, newItem);
      if (fields.length > 0) updated.push({ key, fields });
    }
  }
  return { added, removed, updated };
}

function calculateRevisionChanges(baseline, merged) {
  const names = REGISTRY_NAMES.filter((name) =>
    name !== 'sourceSnapshots' || Object.hasOwn(baseline, name) || Object.hasOwn(merged, name));
  return Object.fromEntries(names.map((name) => [name, registryDiff(name, baseline, merged)]));
}

function markdownInline(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll(TICK, '\\' + TICK)
    .replaceAll('|', '\\|')
    .replaceAll('\r', ' ')
    .replaceAll('\n', ' ');
}

function describeTypedValue(value) {
  if (!isPlainObject(value)) return 'Value not supplied.';
  if (value.status === 'known' && Object.hasOwn(value, 'decimal')) {
    return 'Known value: ' + TICK + markdownInline(value.decimal) + TICK + ' ' + TICK + markdownInline(value.unit) + TICK;
  }
  if (value.status === 'known' && Object.hasOwn(value, 'min')) {
    const minBoundary = value.inclusive.min ? 'inclusive' : 'exclusive';
    const maxBoundary = value.inclusive.max ? 'inclusive' : 'exclusive';
    return 'Known range: minimum ' + TICK + markdownInline(value.min) + TICK + ' (' + minBoundary + '), maximum '
      + TICK + markdownInline(value.max) + TICK + ' (' + maxBoundary + '), unit ' + TICK + markdownInline(value.unit)
      + TICK + ', step ' + TICK + markdownInline(value.step) + TICK;
  }
  if (value.status === 'unknown') {
    return 'Unknown value: reason code ' + TICK + markdownInline(value.reasonCode) + TICK;
  }
  if (value.status === 'not-applicable') return 'Value: Not applicable (status ' + TICK + 'not-applicable' + TICK + ')';
  return 'Value data: ' + TICK + markdownInline(JSON.stringify(sortJsonValue(value))) + TICK;
}

function appendClaimValue(lines, contract, claim) {
  const value = claim.payload.value;
  if (!isPlainObject(value) || !Object.hasOwn(value, 'ruleRef')) {
    lines.push('- ' + describeTypedValue(value));
    return;
  }
  const ref = value.ruleRef;
  const rule = contract.records.find((record) =>
    record.recordId === ref.recordId && record.gameReleaseId === ref.gameReleaseId && record.kind === 'modifier-rule');
  lines.push('- Rule reference: ' + TICK + markdownInline(ref.gameReleaseId + ':' + ref.recordId) + TICK);
  if (!rule) {
    lines.push('- Referenced rule data is not present in this contract.');
    return;
  }
  const payload = rule.payload;
  if (payload.ruleKey) lines.push('- Rule key: ' + TICK + markdownInline(payload.ruleKey) + TICK);
  if (payload.triggerText) lines.push('- Trigger: ' + markdownInline(payload.triggerText));
  if (payload.operation) lines.push('- Operation: ' + TICK + markdownInline(payload.operation) + TICK);
  if (payload.stackingGroup) lines.push('- Stacking group: ' + TICK + markdownInline(payload.stackingGroup) + TICK);
  if (Array.isArray(payload.exclusions) && payload.exclusions.length > 0) {
    lines.push('- Exclusions: ' + payload.exclusions.map((item) => markdownInline(item)).join('; '));
  }
  if (payload.cap !== undefined) lines.push('- Cap: ' + markdownInline(describeTypedValue(payload.cap)));
  if (payload.duration !== undefined) lines.push('- Duration: ' + markdownInline(describeTypedValue(payload.duration)));
  if (payload.expiryText) lines.push('- Expiry: ' + markdownInline(payload.expiryText));
  if (payload.roundingText) lines.push('- Rounding: ' + markdownInline(payload.roundingText));
  if (payload.clampText) lines.push('- Clamp: ' + markdownInline(payload.clampText));
  const evidenceByKey = new Map(contract.records
    .filter((record) => record.kind === 'evidence')
    .map((record) => [JSON.stringify([record.gameReleaseId, record.recordId]), record]));
  lines.push('- Rule evidence:');
  for (const evidenceRef of payload.evidenceRefs || []) {
    const evidence = evidenceByKey.get(JSON.stringify([evidenceRef.gameReleaseId, evidenceRef.recordId]));
    const summary = evidence && evidence.payload && evidence.payload.safeSummary
      ? ': ' + markdownInline(evidence.payload.safeSummary)
      : '';
    lines.push('  - ' + TICK + markdownInline(evidenceRef.gameReleaseId + ':' + evidenceRef.recordId) + TICK + summary);
  }
}

function claimAnalysis(contract) {
  const evidenceByKey = new Map(contract.records
    .filter((record) => record.kind === 'evidence')
    .map((record) => [JSON.stringify([record.gameReleaseId, record.recordId]), record]));
  const claims = contract.records.filter((record) => record.kind === 'claim')
    .slice()
    .sort((left, right) => compareLexical(left.gameReleaseId, right.gameReleaseId) || compareLexical(left.recordId, right.recordId));
  const lines = [
    '# Technical claim analysis',
    '',
    'This generated English analysis summarizes structured Source claim records and their linked safe evidence summaries. It states only the supplied contract data.',
    ''
  ];
  if (claims.length === 0) {
    lines.push('No claim records are present in this candidate.', '');
    return lines.join('\n');
  }
  for (const claim of claims) {
    const payload = claim.payload || {};
    lines.push('## Claim ' + TICK + markdownInline(claim.recordId) + TICK);
    lines.push('');
    lines.push('- Game release: ' + TICK + markdownInline(claim.gameReleaseId) + TICK);
    lines.push('- Property: ' + TICK + markdownInline(payload.property || 'unspecified') + TICK);
    if (payload.targetRef) {
      lines.push('- Target: ' + TICK + markdownInline(payload.targetRef.gameReleaseId + ':' + payload.targetRef.recordId) + TICK);
    }
    appendClaimValue(lines, contract, claim);
    if (payload.basis) lines.push('- Basis: ' + TICK + markdownInline(payload.basis) + TICK);
    lines.push('- Review state: ' + TICK + markdownInline(claim.reviewState) + TICK);
    if (payload.context !== undefined) {
      lines.push('- Context (JSON): ' + TICK + markdownInline(JSON.stringify(sortJsonValue(payload.context))) + TICK);
    }
    const refs = Array.isArray(payload.evidenceRefs) ? payload.evidenceRefs : [];
    lines.push('- Evidence:');
    if (refs.length === 0) lines.push('  - No evidence references are listed.');
    for (const ref of refs) {
      const evidence = evidenceByKey.get(JSON.stringify([ref.gameReleaseId, ref.recordId]));
      const summary = evidence && evidence.payload && evidence.payload.safeSummary
        ? ': ' + markdownInline(evidence.payload.safeSummary)
        : '';
      lines.push('  - ' + TICK + markdownInline(ref.gameReleaseId + ':' + ref.recordId) + TICK + summary);
    }
    lines.push('');
  }
  return lines.join('\n');
}

function revisionLog(baseline, merged, sourceRevision, mode) {
  const changes = calculateRevisionChanges(baseline, merged);
  const lines = [
    '# Source data revision',
    '',
    'Revision: ' + TICK + sourceRevision + TICK,
    'Build mode: ' + TICK + mode + TICK,
    '',
    'This log records differences between the supplied baseline and merged Source data. It does not assert an official game change.',
    ''
  ];
  const labels = {
    gameReleases: 'Game release metadata',
    sourceSnapshots: 'Source snapshots',
    sourceRefs: 'Source references',
    records: 'Records',
    tombstones: 'Tombstones'
  };
  for (const name of REGISTRY_NAMES) {
    if (!Object.hasOwn(changes, name)) continue;
    const diff = changes[name];
    lines.push('## ' + labels[name]);
    lines.push('');
    if (diff.added.length === 0 && diff.removed.length === 0 && diff.updated.length === 0) {
      lines.push('No changes relative to the supplied baseline.', '');
      continue;
    }
    for (const key of diff.added) lines.push('- Added ' + TICK + markdownInline(key) + TICK);
    for (const key of diff.removed) lines.push('- Removed ' + TICK + markdownInline(key) + TICK);
    for (const item of diff.updated) {
      lines.push('- Updated ' + TICK + markdownInline(item.key) + TICK + ': ' + item.fields.map((field) => TICK + markdownInline(field) + TICK).join(', '));
    }
    lines.push('');
  }
  return lines.join('\n');
}

function stableJsonBytes(value) {
  return Buffer.from(JSON.stringify(sortJsonValue(value), null, 2) + '\n', 'utf8');
}

function makeBuildFiles({ contract, baseline, mode, validation }) {
  const semanticBaseline = structuredClone(baseline);
  semanticBaseline.publicationEligible = false;
  for (const item of [...semanticBaseline.records, ...semanticBaseline.tombstones]) item.reviewState = 'pending';
  for (const name of ['gameReleases', 'sourceSnapshots', 'sourceRefs', 'records', 'tombstones', 'reviewReceipts']) {
    if (name === 'sourceSnapshots' && !Object.hasOwn(semanticBaseline, name)) continue;
    semanticBaseline[name].sort((left, right) => compareLexical(registryKey(name, left), registryKey(name, right)));
  }
  const revisionSchema = Object.hasOwn(baseline, 'sourceSnapshots') || Object.hasOwn(contract, 'sourceSnapshots')
    ? 'w05-source-revision/2'
    : 'w05-source-revision/1';
  const sourceRevision = sha256Canonical({
    format: revisionSchema,
    mode,
    baseline: semanticBaseline,
    output: contract
  });
  const changes = calculateRevisionChanges(baseline, contract);
  const revisionDocument = {
    schema: revisionSchema,
    sourceRevision,
    mode,
    note: 'Source data revision only; this does not assert an official game change.',
    changes
  };
  const technical = stableJsonBytes(contract);
  const analysis = Buffer.from(claimAnalysis(contract), 'utf8');
  const revisionJson = stableJsonBytes(revisionDocument);
  const revisionMarkdown = Buffer.from(revisionLog(baseline, contract, sourceRevision, mode), 'utf8');
  const namedFiles = new Map([
    ['analysis.md', analysis],
    ['source-revision.json', revisionJson],
    ['source-revision.md', revisionMarkdown],
    ['technical.json', technical]
  ]);
  const buildIdentity = {
    verified: unverifiedBuildMetadata(contract).length === 0,
    gameReleases: contract.gameReleases.map((release) => ({
      gameReleaseId: release.gameReleaseId,
      gameBuild: release.gameBuild
    })),
    sourceRefs: contract.sourceRefs.map((source) => ({
      gameReleaseId: source.gameReleaseId,
      sourceId: source.sourceId,
      gameBuild: source.gameBuild
    }))
  };
  const limitations = [];
  if (!contract.publicationEligible) {
    limitations.push('The v2 validator does not mark this Source contract publication-eligible.');
  }
  if (!buildIdentity.verified) {
    limitations.push('At least one gameBuild is blank or UNVERIFIED; formal output is blocked.');
  }
  const manifest = {
    schema: 'w05-source-manifest/1',
    sourceRevision,
    mode,
    buildIdentity,
    limitations,
    files: [...namedFiles.entries()].sort(([left], [right]) => compareLexical(left, right)).map(([name, bytes]) => ({
      path: name,
      sha256: sha256Bytes(bytes),
      sizeBytes: bytes.length
    }))
  };
  const manifestBytes = stableJsonBytes(manifest);
  const outputDirectory = sourceRevision;
  const receiptCore = {
    schema: 'w05-source-build-receipt/1',
    sourceRevision,
    mode,
    previewOnly: mode === 'candidate',
    outputDirectory,
    manifestSha256: sha256Bytes(manifestBytes),
    publicationEligible: contract.publicationEligible,
    buildIdentityVerified: buildIdentity.verified,
    limitations,
    validation: validation.validationReceipt
  };
  const receipt = {
    ...receiptCore,
    algorithm: 'sha256',
    receiptSha256: sha256Canonical(receiptCore)
  };
  const receiptBytes = stableJsonBytes(receipt);
  const files = new Map([
    ...namedFiles.entries(),
    ['source-manifest.json', manifestBytes],
    ['source-receipt.json', receiptBytes]
  ]);
  return { sourceRevision, outputDirectory, files, manifest, receipt, changes };
}

function sha256Bytes(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

async function assertNoSymlinkComponents(absolutePath) {
  const parsed = path.parse(absolutePath);
  const segments = absolutePath.slice(parsed.root.length).split(path.sep).filter(Boolean);
  let current = parsed.root;
  for (const segment of segments) {
    current = path.join(current, segment);
    try {
      const info = await lstat(current);
      if (info.isSymbolicLink()) throw new Error('output path contains a symbolic link');
    } catch (error) {
      if (error.code === 'ENOENT') continue;
      throw error;
    }
  }
}

async function inspectExistingOutput(directory, files) {
  await assertNoSymlinkComponents(directory);
  let directoryInfo;
  try { directoryInfo = await lstat(directory); }
  catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
  if (!directoryInfo.isDirectory() || directoryInfo.isSymbolicLink()) throw new Error('immutable output path is not a regular directory');
  const expectedNames = [...files.keys()].sort(compareLexical);
  const actualNames = (await readdir(directory)).sort(compareLexical);
  if (canonicalJsonString(actualNames) !== canonicalJsonString(expectedNames)) {
    throw new Error('immutable output has missing or extra files');
  }
  for (const [name, expected] of files) {
    const filePath = path.join(directory, name);
    const info = await lstat(filePath);
    if (!info.isFile() || info.isSymbolicLink()) throw new Error('immutable output contains a non-regular file: ' + name);
    const actual = await readFile(filePath);
    if (!actual.equals(expected)) throw new Error('immutable output bytes differ: ' + name);
  }
  return true;
}

async function persistImmutableOutput(outRoot, outputDirectory, files) {
  const absoluteRoot = path.resolve(outRoot);
  const destination = path.join(absoluteRoot, outputDirectory);
  await assertNoSymlinkComponents(absoluteRoot);
  if (await inspectExistingOutput(destination, files)) return;

  let rootAlreadyExisted = false;
  try {
    const info = await lstat(absoluteRoot);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('output root must be a regular directory');
    rootAlreadyExisted = true;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  let temporary;
  let revisionParent;
  try {
    await mkdir(absoluteRoot, { recursive: true });
    revisionParent = path.dirname(destination);
    await mkdir(revisionParent, { recursive: true });
    temporary = path.join(absoluteRoot, '.w05-tmp-' + randomUUID());
    await mkdir(temporary);
    for (const [name, bytes] of files) {
      await writeFile(path.join(temporary, name), bytes, { flag: 'wx' });
    }
    try {
      await rename(temporary, destination);
      temporary = undefined;
    } catch (error) {
      if (error.code === 'EEXIST' || error.code === 'ENOTEMPTY') {
        if (await inspectExistingOutput(destination, files)) {
          await rm(temporary, { recursive: true, force: true });
          temporary = undefined;
          return;
        }
      }
      throw error;
    }
  } catch (error) {
    if (temporary) await rm(temporary, { recursive: true, force: true }).catch(() => {});
    if (!rootAlreadyExisted) {
      if (revisionParent) await rmdir(revisionParent).catch(() => {});
      await rmdir(absoluteRoot).catch(() => {});
    }
    throw error;
  }
}

export async function buildContractCandidate({
  baseline,
  authoring,
  candidate,
  outRoot,
  mode = 'candidate'
} = {}) {
  if (!['candidate', 'formal'].includes(mode)) throw new Error('mode must be candidate or formal');
  if (typeof outRoot !== 'string' || outRoot.trim().length === 0) throw new Error('explicit outRoot is required');
  const schema = await loadContractSchema();
  const base = validateInputDocument(baseline, 'baseline', schema);
  const author = validateInputDocument(authoring, 'authoring', schema);
  const next = validateInputDocument(candidate, 'candidate', schema);
  const merge = mergeContractDocuments({ baseline: base, authoring: author, candidate: next });
  if (merge.conflicts.length > 0) throw new Error('merge conflict: ' + JSON.stringify(merge.conflicts));
  const contract = merge.merged;
  const validation = validateMergedContract(contract, schema);
  const unverifiedBuilds = unverifiedBuildMetadata(contract);
  if (mode === 'formal') {
    assertVerifiedBuildMetadata(contract);
    if (!validation.publicationEligible || contract.publicationEligible !== true) {
      throw new Error('formal output requires a publication-eligible contract with current human approvals');
    }
  } else if (validation.publicationEligible && unverifiedBuilds.length > 0) {
    throw new Error('candidate output blocked: publicationEligible cannot be true with unverified build metadata: ' + unverifiedBuilds.join('; '));
  }
  const built = makeBuildFiles({ contract, baseline: base, mode, validation });
  await persistImmutableOutput(outRoot, built.outputDirectory, built.files);
  return {
    contract,
    files: built.files,
    manifest: built.manifest,
    receipt: built.receipt,
    changes: built.changes,
    validation
  };
}

async function readContract(filePath, label) {
  const source = await readFile(filePath, 'utf8');
  let value;
  try { value = JSON.parse(source); }
  catch (error) { throw new Error(label + ' is not valid JSON: ' + error.message); }
  if (!isPlainObject(value)) throw new Error(label + ' must contain a contract object');
  return value;
}

function parseArguments(argv) {
  const values = new Map();
  const allowed = new Set(['--baseline', '--authoring', '--candidate', '--out-root', '--mode']);
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (!allowed.has(flag)) throw new Error('unknown argument: ' + flag);
    if (values.has(flag)) throw new Error('duplicate argument: ' + flag);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(flag + ' requires a value');
    values.set(flag, value);
    index += 1;
  }
  for (const flag of ['--baseline', '--authoring', '--candidate', '--out-root']) {
    if (!values.has(flag)) throw new Error('required argument is missing: ' + flag);
  }
  const mode = values.get('--mode') || 'candidate';
  if (!['candidate', 'formal'].includes(mode)) throw new Error('--mode must be candidate or formal');
  return {
    baselinePath: path.resolve(values.get('--baseline')),
    authoringPath: path.resolve(values.get('--authoring')),
    candidatePath: path.resolve(values.get('--candidate')),
    outRoot: path.resolve(values.get('--out-root')),
    mode
  };
}

async function runCli(argv) {
  const options = parseArguments(argv);
  const [baseline, authoring, candidate] = await Promise.all([
    readContract(options.baselinePath, 'baseline'),
    readContract(options.authoringPath, 'authoring'),
    readContract(options.candidatePath, 'candidate')
  ]);
  const result = await buildContractCandidate({
    baseline,
    authoring,
    candidate,
    outRoot: options.outRoot,
    mode: options.mode
  });
  process.stdout.write(JSON.stringify(result.receipt) + '\n');
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  runCli(process.argv.slice(2)).catch((error) => {
    process.stderr.write(String(error && error.message ? error.message : error) + '\n');
    process.exitCode = 1;
  });
}