import { createReviewReceipt, loadWebAuthoringInputs } from '../scripts/content/contract-authoring.mjs';
import { compileW08Candidate } from '../scripts/content/contract-w08-build.mjs';

const REPOSITORY = 'https://github.com/SyuanTsai/DarkTide-Source-Data';
const RELEASE_ID = 'fixture-r2';
const REVIEWER = Object.freeze({ kind: 'human', id: 'w12-test-reviewer' });
const REVIEWED_AT = '2026-10-24T00:00:00.000Z';
const COMPILER_FILES = [
  'content/schema/v2/shared-candidate.schema.json',
  'scripts/content/contract-authoring.mjs',
  'scripts/content/contract-release.mjs',
  'scripts/content/contract-w08-build.mjs',
  'scripts/content/retained-name-evidence.mjs',
  'scripts/content/contract-w14-history.mjs',
  'src/published/contract.mjs',
].map((filePath, index) => ({ path: filePath, sizeBytes: index + 1, sha256: String(index + 2).repeat(64) }));

function makeMode(name, presentations, extra = {}) {
  const officialSources = presentations.map(item => ({
    officialSourceId: item.nameOfficialSourceId,
    locale: 'en',
    text: 'Immutable source text',
  }));
  const reviewTargets = presentations.map(item => ({
    targetId: 'target:' + item.authoringId + ':name',
    ownerId: item.authoringId,
    fieldPath: '/name',
    dimension: 'content',
  }));
  const authoring = {
    schemaVersion: '2.0.0',
    contractKind: 'web-authoring',
    fixtureOnly: false,
    publicationEligible: false,
    sourcePin: {},
    officialInputsSha256: 'a'.repeat(64),
    presentations,
    termLocalizations: [],
    announcements: [],
    gameChanges: [],
    officialTextChanges: [],
    reviewTargets,
    reviewReceipts: [],
  };
  return {
    mode: name,
    authoring,
    officialInputs: { sources: officialSources },
    termRules: { rules: [] },
    reviewStates: Object.fromEntries(reviewTargets.map(target => [target.targetId, 'pending'])),
    webLock: {},
    ...extra,
  };
}

function collectRecordRefs(value, refs = []) {
  if (Array.isArray(value)) {
    for (const item of value) collectRecordRefs(item, refs);
    return refs;
  }
  if (!value || typeof value !== 'object') return refs;
  if (typeof value.gameReleaseId === 'string' && typeof value.recordId === 'string') refs.push(value);
  for (const child of Object.values(value)) collectRecordRefs(child, refs);
  return refs;
}

function makeCompilerInput(donor, {
  omitSourceChange = false,
  removeWeaponPredecessor = false,
  changeTargetKind = null,
  knownRangeChange = false,
  includeCorrectionChain = false,
  subjectPresentationInW06 = false,
} = {}) {
  const sourceContract = structuredClone(donor.sourceContract);
  sourceContract.fixtureOnly = false;
  sourceContract.publicationEligible = false;
  const release = sourceContract.gameReleases.find(item => item.gameReleaseId === RELEASE_ID);
  if (!release) throw new Error('The W08 compiler fixture donor has no fixture-r2 release');

  const authoring = structuredClone(donor.authoring);
  authoring.presentations = authoring.presentations.filter(item => item.entityRef.gameReleaseId === RELEASE_ID
    && ['skill', 'blessing', 'weapon'].includes(item.entityRef.kind));
  if (includeCorrectionChain) {
    const sourceChange = authoring.gameChanges.find(item => item.changeId === 'fixture:game-change:curve');
    const previousChange = authoring.officialTextChanges.find(item => item.changeId === 'fixture:official-text-change:weapon');
    if (!sourceChange || !previousChange) throw new Error('W12 compiler fixture has no correction-chain endpoints');
    sourceChange.supersedesChangeId = previousChange.changeId;
  }
  const extraOfficialSources = [];
  if (changeTargetKind === 'blessing-variant') {
    const sourcePresentation = donor.authoring.presentations.find(item => item.entityRef.kind === 'blessing');
    const targetBlessing = sourceContract.records.find(record => record.gameReleaseId === RELEASE_ID
      && record.kind === 'blessing' && record.recordId === sourcePresentation?.entityRef.recordId);
    const targetVariant = sourceContract.records.find(record => record.gameReleaseId === RELEASE_ID
      && record.kind === 'blessing-variant' && record.payload?.blessingRef?.recordId === targetBlessing?.recordId);
    const sourceOfficial = donor.officialInputs.sources.find(row => row.officialSourceId === sourcePresentation?.official?.officialSourceId);
    if (!sourcePresentation || !targetBlessing || !targetVariant || !sourceOfficial) {
      throw new Error('W12 fixture cannot construct a localized blessing parent for its variant target');
    }
    const blessingRef = { gameReleaseId: RELEASE_ID, kind: 'blessing', recordId: targetBlessing.recordId };
    const blessingPresentation = structuredClone(sourcePresentation);
    blessingPresentation.authoringId = 'fixture:presentation:blessing-r2';
    blessingPresentation.entityRef = blessingRef;
    blessingPresentation.nameOfficialSourceId = 'fixture:official:blessing-r2';
    blessingPresentation.official.officialSourceId = 'fixture:official:blessing-r2';
    blessingPresentation.official.entityRef = blessingRef;
    blessingPresentation.faithfulTranslation.sourceId = 'fixture:official:blessing-r2';
    blessingPresentation.tierApplicability = [{
      variantRef: { gameReleaseId: RELEASE_ID, kind: 'blessing-variant', recordId: targetVariant.recordId },
      tiers: [...targetVariant.payload.definedTiers],
    }];
    authoring.presentations.push(blessingPresentation);
    const officialInput = structuredClone(sourceOfficial);
    officialInput.officialSourceId = 'fixture:official:blessing-r2';
    officialInput.entityRef = blessingRef;
    extraOfficialSources.push(officialInput);
    const sourceTarget = donor.authoring.reviewTargets.find(row => row.ownerId === sourcePresentation.authoringId
      && row.fieldPath === '/name');
    if (!sourceTarget) throw new Error('W12 fixture has no validated blessing-name review target');
    authoring.reviewTargets.push({ ...structuredClone(sourceTarget),
      targetId: 'target:fixture:presentation:blessing-r2:name', ownerId: blessingPresentation.authoringId });
  }
  authoring.termLocalizations = authoring.termLocalizations.filter(item => item.termRef.gameReleaseId === RELEASE_ID);
  authoring.announcements = [];
  if (omitSourceChange) authoring.gameChanges = [];
  if (removeWeaponPredecessor) {
    const weapon = sourceContract.records.find(record => record.gameReleaseId === RELEASE_ID
      && record.recordId === 'fixture:weapon:alpha');
    if (weapon?.payload?.predecessorRef) delete weapon.payload.predecessorRef;
  }
  const sourceRecordMap = new Map(sourceContract.records.map(record => [record.gameReleaseId + '\u0000' + record.recordId, record]));
  const seeds = sourceContract.records.filter(record => record.gameReleaseId === RELEASE_ID
    && ['skill', 'blessing', 'weapon', 'term', 'armor-class'].includes(record.kind)
    || (record.kind === 'release-compatibility'
      && (record.gameReleaseId === RELEASE_ID || record.payload?.toGameReleaseId === RELEASE_ID)));
  for (const ref of collectRecordRefs([
    ...authoring.presentations,
    ...authoring.termLocalizations,
    ...authoring.gameChanges,
    ...authoring.officialTextChanges,
  ])) {
    const record = sourceRecordMap.get(ref.gameReleaseId + '\u0000' + ref.recordId);
    if (!record) throw new Error('W12 fixture Web reference does not resolve: ' + ref.gameReleaseId + ':' + ref.recordId);
    seeds.push(record);
  }
  const selected = new Map();
  const queue = [...seeds];
  while (queue.length) {
    const record = queue.pop();
    const key = record.gameReleaseId + '\u0000' + record.recordId;
    if (selected.has(key)) continue;
    selected.set(key, record);
    for (const ref of collectRecordRefs(record.payload)) {
      const target = sourceRecordMap.get(ref.gameReleaseId + '\u0000' + ref.recordId);
      if (!target) throw new Error('W12 fixture Source reference does not resolve: ' + ref.gameReleaseId + ':' + ref.recordId);
      selected.set(key, record);
      queue.push(target);
    }
  }
  sourceContract.records = [...selected.values()];
  sourceContract.tombstones = [];
  const selectedKeys = new Set(selected.keys());
  sourceContract.reviewReceipts = sourceContract.reviewReceipts.filter(receipt =>
    selectedKeys.has(receipt.target?.gameReleaseId + '\u0000' + receipt.target?.recordId));
  const ownerIds = new Set([
    ...authoring.presentations.map(item => item.authoringId),
    ...authoring.termLocalizations.map(item => item.authoringId),
    ...authoring.gameChanges.map(item => item.changeId),
    ...authoring.officialTextChanges.map(item => item.changeId),
  ]);
  authoring.reviewTargets = authoring.reviewTargets.filter(target => ownerIds.has(target.ownerId));
  const targetIds = new Set(authoring.reviewTargets.map(target => target.targetId));
  authoring.reviewReceipts = authoring.reviewReceipts.filter(receipt => targetIds.has(receipt.targetId));

  const sourceChange = sourceContract.records.find(record => record.recordId === 'fixture:game-change:curve');
  if (!omitSourceChange && !sourceChange) throw new Error('The W08 compiler fixture donor has no Source game-change record');
  if (sourceChange) {
    if (knownRangeChange) {
      sourceChange.payload.changedFields[0].before = { status: 'known', decimal: '0.2', unit: 'ratio' };
      sourceChange.payload.changedFields[0].after = {
        status: 'known', min: '0.25', max: '0.75', unit: 'ratio',
        inclusive: { min: true, max: false }, step: '0.05',
      };
      sourceChange.payload.changedFields[0].unit = 'ratio';
    }
    if (changeTargetKind) {
      const weapon = sourceContract.records.find(record => record.gameReleaseId === RELEASE_ID
        && record.kind === 'weapon' && record.recordId === 'fixture:weapon:alpha');
      let target = null;
      if (changeTargetKind === 'stat-definition') {
        target = sourceContract.records.find(record => weapon?.payload.statRefs?.some(ref =>
          ref.recordId === record.recordId && ref.gameReleaseId === record.gameReleaseId && record.kind === 'stat-definition'));
      } else if (changeTargetKind === 'stat-curve') {
        const stat = sourceContract.records.find(record => weapon?.payload.statRefs?.some(ref =>
          ref.recordId === record.recordId && ref.gameReleaseId === record.gameReleaseId && record.kind === 'stat-definition'));
        target = sourceContract.records.find(record => stat?.payload.curveRef?.recordId === record.recordId
          && stat.payload.curveRef.gameReleaseId === record.gameReleaseId && record.kind === 'stat-curve');
      } else if (changeTargetKind === 'blessing-variant') {
        target = sourceContract.records.find(record => record.gameReleaseId === RELEASE_ID && record.kind === 'blessing-variant');
      }
      if (!target) throw new Error('W12 fixture has no supported change target of kind ' + changeTargetKind);
      sourceChange.payload.entityRef = { gameReleaseId: target.gameReleaseId, recordId: target.recordId };
    }
    sourceChange.reviewState = 'approved';
    for (const target of sourceChange.reviewTargets ?? []) {
      const receiptTarget = {
        gameReleaseId: sourceChange.gameReleaseId,
        recordId: sourceChange.recordId,
        fieldPath: target.fieldPath,
        dimension: target.dimension,
      };
      sourceContract.reviewReceipts.push(donor.sourceValidator.createReviewReceipt(sourceContract, receiptTarget, {
        decision: 'approved', reviewer: REVIEWER, reviewedAt: REVIEWED_AT,
      }));
    }
  if (changeTargetKind === 'blessing-variant' && sourceChange) {
    const variantRef = sourceChange.payload.entityRef;
    const variant = sourceContract.records.find(record => record.kind === 'blessing-variant'
      && record.gameReleaseId === variantRef.gameReleaseId && record.recordId === variantRef.recordId);
    if (!variant) throw new Error('W12 compiler fixture has no blessing variant target');
    variant.reviewState = 'approved';
    for (const target of variant.reviewTargets ?? []) {
      const receiptTarget = {
        gameReleaseId: variant.gameReleaseId,
        recordId: variant.recordId,
        fieldPath: target.fieldPath,
        dimension: target.dimension,
      };
      sourceContract.reviewReceipts.push(donor.sourceValidator.createReviewReceipt(sourceContract, receiptTarget, {
        decision: 'approved', reviewer: REVIEWER, reviewedAt: REVIEWED_AT,
      }));
    }
  }
  }
  const sourceValidation = donor.sourceValidator.validateSourceContract(sourceContract, { schema: donor.sourceSchema });
  if (!sourceValidation.valid) throw new Error('W12 synthetic Source review fixture is invalid: '
    + sourceValidation.issues.map(issue => issue.message).join('; '));

  let w06Presentations = [];
  if (subjectPresentationInW06) {
    const targetRef = sourceChange?.payload?.entityRef;
    const index = authoring.presentations.findIndex(item => item.entityRef?.recordId === targetRef?.recordId
      && item.entityRef?.gameReleaseId === targetRef?.gameReleaseId
      && (!targetRef?.kind || item.entityRef?.kind === targetRef.kind));
    if (index < 0) throw new Error('W12 fixture has no localized subject presentation to place in W06');
    const [presentation] = authoring.presentations.splice(index, 1);
    w06Presentations = [presentation];
    authoring.reviewTargets = authoring.reviewTargets.filter(target => target.ownerId !== presentation.authoringId);
    const retainedTargetIds = new Set(authoring.reviewTargets.map(target => target.targetId));
    authoring.reviewReceipts = authoring.reviewReceipts.filter(receipt => retainedTargetIds.has(receipt.targetId));
  }
  const w06 = makeMode('w06', w06Presentations);
  w06.sourceContract = structuredClone(sourceContract);
  w06.officialInputs = subjectPresentationInW06 ? structuredClone(donor.officialInputs) : { sources: [] };
  w06.termRules = structuredClone(donor.termRules);
  const w07 = makeMode('w07', []);
  w07.authoring = authoring;
  w07.sourceContract = structuredClone(sourceContract);
  w07.officialInputs = structuredClone(donor.officialInputs);
  w07.officialInputs.sources.push(...extraOfficialSources);
  w07.termRules = structuredClone(donor.termRules);
  w07.sourceValidator = donor.sourceValidator;
  w07.sourceRecordMap = new Map(sourceContract.records.map(record => [record.gameReleaseId + '\u0000' + record.recordId, record]));
  const reviewedOwnerIds = new Set([
    ...authoring.gameChanges.map(change => change.changeId),
    ...authoring.officialTextChanges.map(change => change.changeId),
    ...authoring.presentations.filter(item => ['weapon', 'blessing'].includes(item.entityRef.kind))
      .map(item => item.authoringId),
  ]);
  for (const target of authoring.reviewTargets.filter(row => reviewedOwnerIds.has(row.ownerId)
    && (['game-change', 'official-text-change'].includes(row.ownerKind)
      || (row.ownerKind === 'presentation' && row.fieldPath === '/name')))) {
    authoring.reviewReceipts.push(createReviewReceipt(authoring, target, {
      sourceContract,
      officialInputs: w07.officialInputs,
      sourceValidator: donor.sourceValidator,
      sourceRecordMap: w07.sourceRecordMap,
      termRules: w07.termRules,
      mode: 'w07',
      reviewer: REVIEWER,
      reviewedAt: REVIEWED_AT,
    }));
  }
  w07.authoring = authoring;
  w07.reviewStates = Object.fromEntries(authoring.reviewTargets.map(target => [target.targetId, 'approved']));

  return {
    sourceContract,
    sourceBuild: {
      repository: REPOSITORY,
      commit: 'b'.repeat(40),
      sourceRevision: '1'.repeat(64),
      manifestSha256: '2'.repeat(64),
      mode: 'candidate',
      buildIdentityVerified: false,
      publicationEligible: false,
      receiptSha256: null,
    },
    compilerIdentity: {
      commit: 'a'.repeat(40),
      inputLockSha256: '9'.repeat(64),
      files: COMPILER_FILES.map(row => ({ ...row })),
      gitHistoryAvailable: true,
    },
    webIdentity: { authoringCommit: '8'.repeat(40), compilerCommit: 'a'.repeat(40) },
    w06,
    w07,
    proposedContentVersion: release.gameVersion + '.1',
    gameReleaseId: RELEASE_ID,
  };
}

/** Compile a minimal event domain with the actual W08 compiler and repository's validated fixture donor. */
export async function makeCompiledGameChangesPackage(options = {}) {
  const donor = await loadWebAuthoringInputs();
  const compiled = compileW08Candidate(makeCompilerInput(donor, options));
  const domains = compiled.manifest.files.map(file => {
    const bytes = compiled.files.get(file.path);
    if (!bytes) throw new Error('W08 compiler omitted ' + file.path);
    return JSON.parse(bytes.toString('utf8'));
  });
  if (!domains.some(domain => domain.kind === 'game-changes')) throw new Error('W08 compiler did not emit the fixture game-changes domain');
  return {
    domains,
    manifest: compiled.manifest,
    files: compiled.files,
    publicationEligible: compiled.envelope.publicationGate?.eligible === true,
  };
}

export async function makeCompiledGameChangesDomain() {
  const compiled = await makeCompiledGameChangesPackage();
  return compiled.domains.find(domain => domain.kind === 'game-changes');
}
