import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile, readdir, writeFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { canonicalBytes } from './w06-generic-blessing-presentations.mjs';
import { createReviewReceipt, getReviewState, validateWebAuthoring, loadWebAuthoringInputs } from './contract-authoring.mjs';
import { createW09AuthoringSourcePin } from './contract-w09-compose.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');

// Keep this offline adapter outside the compiler's pinned file set. The Source
// runtime loader verifies the approved Git blobs before loading the validator.
async function loadPinnedSourceApi(repoRoot, head) {
  const gitBlob = file => execFileSync('git', ['show', head + ':' + file], { cwd: repoRoot, maxBuffer: 1024 * 1024 });
  const cachePath = 'content/contracts/w09/source-request/contract-w09-request.mjs';
  const lock = JSON.parse(gitBlob('content/contracts/w09/source-request.lock.json'));
  const keys = ['schema', 'repository', 'commit', 'sourcePath', 'cachePath', 'sizeBytes', 'sha256'];
  if (Object.keys(lock).length !== keys.length || keys.some(key => !Object.hasOwn(lock, key))
      || lock.schema !== 'w09-source-request-lock/1' || lock.repository !== 'SyuanTsai/DarkTide-Source-Data'
      || lock.sourcePath !== 'scripts/content/contract-w09-request.mjs' || lock.cachePath !== cachePath
      || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(lock.commit) || !/^[a-f0-9]{64}$/.test(lock.sha256)
      || !Number.isSafeInteger(lock.sizeBytes) || lock.sizeBytes < 1) throw new Error('Source request cache lock identity is invalid');
  const pinned = gitBlob(cachePath), modulePath = path.join(repoRoot, cachePath);
  if (pinned.length !== lock.sizeBytes || sha(pinned) !== lock.sha256 || !(await readFile(modulePath)).equals(pinned)) throw new Error('Cached Source request module differs from its fixed raw Git lock');
  const api = await import(pathToFileURL(modulePath).href + '?sha256=' + lock.sha256);
  for (const name of ['verifyW09SourceArchive', 'loadW09ApprovedSourceRuntime', 'cleanupW09ApprovedSourceRuntime']) {
    if (typeof api[name] !== 'function') throw new Error('Pinned Source request cache omits ' + name);
  }
  return api;
}

async function makeSourceLock(request, sourceRoot, sourceApi) {
  const dataInput = request.sourceInputs.find(input => input.role === 'candidate');
  if (!dataInput) throw new Error('Verified Source request omits its candidate input pin');
  const schemaPath = 'content/schema/v2/source-contract.schema.json';
  const validatorPath = 'scripts/content/contract-validator.mjs';
  let runtime, cleaned = false;
  const cleanup = async () => {
    if (!runtime || cleaned) return;
    await sourceApi.cleanupW09ApprovedSourceRuntime(runtime);
    cleaned = true;
  };
  try {
    runtime = await sourceApi.loadW09ApprovedSourceRuntime({ sourceRoot, sourceCommit: request.sourceCommit });
    if (runtime?.identity?.sourceCommit !== request.sourceCommit
        || typeof runtime.validator?.validateSourceContract !== 'function'
        || typeof runtime.validator?.assertSchemaValidatorParity !== 'function'
        || !runtime.schema || typeof runtime.schema !== 'object' || Array.isArray(runtime.schema)
        || !Array.isArray(runtime.identity.files)) throw new Error('Approved Source runtime identity or validator interface is invalid');
    const files = new Map(runtime.identity.files.map(row => [row.path, row]));
    const schemaPin = files.get(schemaPath), validatorPin = files.get(validatorPath);
    if (!schemaPin || !validatorPin) throw new Error('Approved Source runtime omits pinned schema or validator');
    if (runtime.validator.CONTRACT_SCHEMA_ID !== runtime.schema.$id) throw new Error('Pinned Source schema/validator identity mismatch');
    runtime.validator.assertSchemaValidatorParity(runtime.schema);
    return {
      lock: { schemaVersion: 'w09-source-contract-pin/1', repository: 'https://github.com/SyuanTsai/DarkTide-Source-Data',
        commit: request.sourceCommit, schemaId: runtime.validator.CONTRACT_SCHEMA_ID,
        files: { schema: { path: schemaPath, sha256: schemaPin.sha256 }, data: { path: dataInput.path, sha256: dataInput.sha256 }, validator: { path: validatorPath, sha256: validatorPin.sha256 } } },
      schema: runtime.schema, validator: runtime.validator, cleanup,
    };
  } catch (cause) {
    try { await cleanup(); }
    catch (cleanupError) { throw new AggregateError([cause, cleanupError], 'Approved Source runtime loading and cleanup both failed'); }
    throw cause;
  }
}

export function applyApprovedReceipts({ authoring, additions, approval, packageDigest, inputs }) {
  const digest = sha(canonicalBytes(additions));
  if (approval?.decision !== 'approved' || approval.reviewer?.kind !== 'human' || typeof approval.reviewer.id !== 'string' || !approval.reviewer.id.trim()
      || digest !== packageDigest || digest !== approval.reviewedPackage?.packageDigest) throw new Error('Approval or package digest mismatch');
  const output = structuredClone(authoring);
  for (const target of additions.reviewTargets) output.reviewReceipts.push(createReviewReceipt(output, target, { ...inputs, reviewer: approval.reviewer, reviewedAt: approval.reviewedAt }));
  for (const target of additions.reviewTargets) if (getReviewState(output, target.targetId, inputs) !== 'approved') throw new Error('Target is not approved: ' + target.targetId);
  return output;
}

async function overlay(kind, digest) {
  if (!/^[a-f0-9]{8,64}$/.test(digest)) throw new Error('Invalid overlay digest');
  const dir = path.join(ROOT, 'content/contracts/w09/authoring-overlays/w06', kind);
  const files = (await readdir(dir)).filter(f => f.startsWith(digest) && /^[a-f0-9]{64}\.json$/.test(f));
  if (files.length !== 1) throw new Error('Overlay digest must resolve uniquely: ' + digest);
  const filename = path.join(dir, files[0]), bytes = await readFile(filename);
  if (sha(bytes) + '.json' !== files[0]) throw new Error('Overlay hash mismatch');
  return { filename, value: JSON.parse(bytes), digest: sha(bytes) };
}

function difference(current, base, key) {
  const existing = new Map(base.map(row => [row[key], canonicalBytes(row).toString()]));
  for (const row of current) if (existing.has(row[key])) {
    if (existing.get(row[key]) !== canonicalBytes(row).toString()) throw new Error('Base entry changed: ' + row[key]);
    existing.delete(row[key]);
  }
  if (existing.size) throw new Error('Base entry missing');
  const baseIds = new Set(base.map(row => row[key]));
  return current.filter(row => !baseIds.has(row[key]));
}

async function main() {
  const { values } = parseArgs({ options: { apply: { type: 'boolean' }, approval: { type: 'string' }, 'source-archive': { type: 'string' }, 'base-authoring': { type: 'string' }, 'source-root': { type: 'string' } }, strict: true });
  if (!values.apply || !values.approval || !values['source-archive']) throw new Error('Required: --apply --approval <file> --source-archive <file> [--source-root <Source repository>]');
  const reportPath = path.join(ROOT, 'content/reviews/syp-288-blessing-presentations');
  const report = JSON.parse(await readFile(path.join(reportPath, 'review-package.json'))), approval = JSON.parse(await readFile(values.approval));
  const [base, current, baseOfficial, official] = await Promise.all([
    overlay('authoring', values['base-authoring'] ?? report.baseAuthoring), overlay('authoring', report.outputs.authoring.sha256),
    overlay('officialInputs', report.baseOfficialInputs), overlay('officialInputs', report.outputs.officialInputs.sha256),
  ]);
  const additions = { presentations: difference(current.value.presentations, base.value.presentations, 'authoringId'), officialInputs: difference(official.value.sources, baseOfficial.value.sources, 'officialSourceId'), reviewTargets: difference(current.value.reviewTargets, base.value.reviewTargets, 'targetId') };
  if (sha(canonicalBytes(additions)) !== report.packageDigest || approval?.decision !== 'approved' || approval.reviewer?.kind !== 'human' || approval.reviewedPackage?.packageDigest !== report.packageDigest) throw new Error('Approval or package digest mismatch');
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
  const api = await loadPinnedSourceApi(ROOT, head);
  const archiveBytes = await readFile(values['source-archive']);
  if (sha(archiveBytes) !== '0c4b21957f5cb2bda0dbffb1ddae715c06c98692c914109e54983ffb4a3fc02a') throw new Error('Unexpected Source archive SHA-256');
  const verified = api.verifyW09SourceArchive({ bytes: archiveBytes });
  const request = verified.archive.request, sourceContract = JSON.parse(verified.files.get('technical.json'));
  const sourcePin = await makeSourceLock(request, path.resolve(values['source-root'] ?? path.join(ROOT, '../../DarkTide-Source-Data')), api);
  try {
    const sourceValidation = sourcePin.validator.validateSourceContract(sourceContract, { schema: sourcePin.schema });
    if (sourceContract.fixtureOnly !== false || sourceContract.publicationEligible !== true || !sourceValidation.valid || sourceValidation.publicationEligible !== true) throw new Error('Source contract validation failed');
    const inputs = await loadWebAuthoringInputs({ repoRoot: ROOT, mode: 'w06' });
    Object.assign(inputs, { sourceContract, sourceLock: sourcePin.lock, sourceSchema: sourcePin.schema, sourceValidator: sourcePin.validator, sourceValidation,
      sourceRecordMap: new Map(sourceContract.records.map(r => [r.gameReleaseId + '\0' + r.recordId, r])), sourceReleaseMap: new Map(sourceContract.gameReleases.map(r => [r.gameReleaseId, r])), officialInputs: official.value });
    inputs.webLock.officialInputs = { ...inputs.webLock.officialInputs, sha256: official.digest };
    const projected = { ...current.value, sourcePin: createW09AuthoringSourcePin(sourcePin.lock), officialInputsSha256: official.digest };
    const result = applyApprovedReceipts({ authoring: projected, additions, approval, packageDigest: report.packageDigest, inputs });
    const validation = validateWebAuthoring(result, inputs);
    if (!validation.valid) throw new Error('Authoring validation failed: ' + JSON.stringify(validation.issues));
    // Persist the original overlay pin; compose projects the current pin at publication.
    result.sourcePin = current.value.sourcePin;
    const bytes = canonicalBytes(result), digest = sha(bytes), filename = path.join(path.dirname(current.filename), digest + '.json');
    try { await writeFile(filename, bytes, { flag: 'wx' }); }
    catch (error) { if (error.code !== 'EEXIST' || !(await readFile(filename)).equals(bytes)) throw error; }
    await writeFile(path.join(reportPath, 'apply-result.json'), canonicalBytes({ sha256: digest, filename: path.basename(filename), sizeBytes: bytes.length, addedReceipts: additions.reviewTargets.length, validation: 'valid', packageDigest: report.packageDigest }));
    await unlink(current.filename);
    console.log(JSON.stringify({ sha256: digest, sizeBytes: bytes.length, addedReceipts: additions.reviewTargets.length, validation: 'valid' }));
  } finally { await sourcePin.cleanup(); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error); process.exitCode = 1; });
