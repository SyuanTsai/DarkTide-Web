import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

import { walkW03LedgerShards } from './contract-w14-ledger.mjs';

export const W14_DOMAIN_MATRIX_SCHEMA = 'w14.domain-matrix.v1';

const WEB_W13_COMMIT = '100e3c0339078b5ed985e103d0ead818c361feb9';
const W13_RELEASE_ID = 'w09-1a09e5ffcc1daf5358d2692b9234c9db';
const W13_REQUEST_ID = '409ca538ee46a531bb5ec3e11db321ec0de477c9248ec2c3db105f44aec11ecf';
const W13_CANDIDATE_PATH = `content/contracts/w09/prepared/${W13_RELEASE_ID}/candidate.json`;
const W13_DATA_REVISION = '82b79e47e88717b4237655fe4909f0754bac18238c3a23530b985effd60f3130';
const W13_SOURCE_REVISION = '83e70e7946bd13738ea97ec6731daeb4df5eb42edec8e1e819f428ee2197005d';
const W13_SOURCE_TECHNICAL_SHA256 = '052514ee1a1dc8d4754189f3ca1c3dbc626b1e7577b282b3de001f03ed459dd2';
const W13_CANDIDATE_SHA256 = 'd113c63275233a77da6c6b3e55a0f3bac3e617686d3e94d11982a8e4dddc83a1';
const W13_CANDIDATE_BLOB = 'b1250b665088e48da2d383cd50924336fb20f018';
const W13_GAME_RELEASE_ID = 'darktide:1.13.2';
const W13_CURRENT_CONTENT_VERSION = '1.13.2.2';
const W13_MANIFEST_SHA256 = '29eeab431bba18dace68ade5f057183f99e23cc3419a22c0c08b0d7096d4a3a6';
const W13_CORE_DOMAIN_PINS = Object.freeze({
  skills: { sha256: '108628d9c9262541bd95741fcc0ef52b08ff874d02ce11eb0684bb52ef6da449', byteLength: 165051, gitBlobOid: '1a1fea92095298f6d29720791c69d5060aad15aa' },
  blessings: { sha256: '3e72d21be03b7beb966558665b7a4eb3fb389ea23fab8cf7c1cf722a409b22b5', byteLength: 113990, gitBlobOid: 'b37ac222aa955bb0dee81fda91db2b402680816e' },
  weapons: { sha256: '132ec16e830d4af560bd212095f4fa0209bc8f238eb17a26528e112e6ebd41a8', byteLength: 6798596, gitBlobOid: '4ca1704ecec6f88cabc4a9eed30caac2abd6964b' },
  terms: { sha256: '602cb6aca68e6add34aaa8eb0552efbba66324a97e7c4fbc406f03c0932b78f6', byteLength: 124557, gitBlobOid: '89ca522d13c613bf0c8c04ee0fa307769e28c708' },
});
const SOURCE_ARCHIVE_COMMIT = '805fa5ea3df2482419c967b4e82d019b65338065';
const W03_LEDGER_SHA256 = 'bdf4b02c278e9dafef9aea00ac8263fe7929b29e9dc0eb90325cf7c55daa2288';
const W03_MODS_LEDGER_SHA256 = '90d1d27ed7673db16ff3c5b82640f2af7847466fc5a7a4fcd7d1f9795ee9af16';
const A_EXPECTED_COUNT = 1315656;
const MODS_EXPECTED_COUNT = 191861;
const CORE_DOMAIN_NAMES = ['skills', 'blessings', 'weapons', 'terms'];

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const gitBlobOid = bytes => createHash('sha1').update(Buffer.from(`blob ${bytes.length}\0`, 'ascii')).update(bytes).digest('hex');
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const stableJson = value => JSON.stringify(value);
const compare = (left, right) => left < right ? -1 : left > right ? 1 : 0;

function decodeJson(bytes, label) {
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch (error) { throw new Error(`${label} is not valid UTF-8 JSON: ${error.message}`); }
}

function readGitBlob(repoRoot, commit, repoPath, maxBuffer = 24 * 1024 * 1024) {
  if (typeof repoRoot !== 'string' || !repoRoot || !/^[a-f0-9]{40}$/u.test(commit)
    || typeof repoPath !== 'string' || repoPath.startsWith('/') || repoPath.includes('\\')
    || repoPath.split('/').some(part => !part || part === '.' || part === '..')) {
    throw new TypeError('pinned Git blob locator is malformed');
  }
  return execFileSync('git', ['cat-file', 'blob', `${commit}:${repoPath}`], {
    cwd: repoRoot, maxBuffer, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
  });
}

function exactSourceIdentity(record) {
  return `${record.gameReleaseId}\0${record.recordId}`;
}

function classifyArchivedExtensionInput(sourcePath) {
  if (sourcePath === 'data/v1/mechanics/player-guides.json') return 'historical-player-guide-input';
  if (sourcePath.startsWith('data/v1/domains/')) return 'historical-extension-domain-input';
  if (sourcePath.startsWith('data/v1/closure/')) return 'historical-domain-closure-or-proposal-input';
  if (sourcePath.startsWith('data/v1/mechanics/')) return 'historical-mechanics-or-review-support-input';
  if (sourcePath === 'data/v1/review-approvals.json') return 'historical-review-receipt-input-not-carried-forward';
  if (sourcePath.startsWith('data/v1/website-')) return 'historical-website-display-or-token-input';
  if (sourcePath === 'data/v1/catalog.json' || sourcePath === 'data/v1/class-overview.json') return 'historical-catalog-or-class-input';
  if (sourcePath === 'data/v1/weapon-actions.json') return 'historical-weapon-action-input';
  if (sourcePath.startsWith('data/v1/')) return 'historical-extension-data-input';
  if (sourcePath.startsWith('docs/V1_')) return 'historical-review-document-input-body-not-republished';
  return 'historical-input-role-not-inferred';
}

function summarizeWebOwners(domain) {
  return {
    presentations: domain.web.presentations.map(item => ({
      authoringId: item.authoringId,
      entityRef: item.entityRef ?? item.official?.entityRef ?? null,
      locale: item.locale,
      displayedName: item.name,
      officialSourceId: item.official?.officialSourceId ?? item.nameOfficialSourceId ?? null,
      blessingContext: item.official?.bindingContext ?? null,
      tierApplicability: item.tierApplicability ?? [],
      weaponMarkIdentity: item.weaponView?.markRef ?? item.weaponView?.markId ?? item.weaponView?.templateKey ?? null,
    })),
    termLocalizations: domain.web.termLocalizations.map(item => ({
      authoringId: item.authoringId,
      termRef: item.termRef,
      contextKey: item.contextKey,
      locale: item.locale,
      displayedLabel: item.label,
    })),
  };
}

/** Summarize the four W08 domains against a pinned Source technical packet without name joins. */
export function summarizeW14SharedPackage({ domains, technicalRecords, gameReleaseId }) {
  if (!isObject(domains) || !Array.isArray(technicalRecords) || typeof gameReleaseId !== 'string' || !gameReleaseId) {
    throw new TypeError('four core domains, technical records, and exact current gameReleaseId are required');
  }
  if (stableJson(Object.keys(domains).sort()) !== stableJson([...CORE_DOMAIN_NAMES].sort())) {
    throw new Error('shared package must contain exactly skills, blessings, weapons, and terms domains');
  }
  const copies = new Map();
  const domainSummary = [];
  let recordCopyCount = 0;
  let webPresentationCount = 0;
  let termLocalizationCount = 0;
  let webReviewTargetCount = 0;
  for (const name of CORE_DOMAIN_NAMES) {
    const domain = domains[name];
    if (!isObject(domain) || domain.kind !== name || domain.gameReleaseId !== gameReleaseId
      || !Array.isArray(domain.source?.records) || !isObject(domain.web)) {
      throw new Error(`shared ${name} domain is missing its exact release or typed records`);
    }
    const kindCounts = {};
    const localIds = new Set();
    for (const record of domain.source.records) {
      if (!isObject(record) || typeof record.recordId !== 'string' || !record.recordId
        || typeof record.gameReleaseId !== 'string' || typeof record.kind !== 'string') {
        throw new Error(`shared ${name} domain has a malformed stable record identity`);
      }
      const key = exactSourceIdentity(record);
      if (localIds.has(key)) throw new Error(`shared ${name} domain repeats a release-qualified Source identity`);
      localIds.add(key);
      const prior = copies.get(key);
      if (prior && stableJson(prior.record) !== stableJson(record)) {
        throw new Error(`conflicting Source record copies for ${record.gameReleaseId}:${record.recordId}`);
      }
      if (!prior) copies.set(key, { record, domains: [] });
      copies.get(key).domains.push(name);
      kindCounts[record.kind] = (kindCounts[record.kind] ?? 0) + 1;
      recordCopyCount++;
    }
    const lists = ['presentations', 'termLocalizations', 'announcements', 'gameChanges', 'officialTextChanges', 'reviewTargets'];
    for (const listName of lists) {
      if (!Array.isArray(domain.web[listName])) throw new Error(`shared ${name} web.${listName} must be an array`);
    }
    webPresentationCount += domain.web.presentations.length;
    termLocalizationCount += domain.web.termLocalizations.length;
    webReviewTargetCount += domain.web.reviewTargets.length;
    domainSummary.push({
      name,
      kindCounts: Object.fromEntries(Object.entries(kindCounts).sort(([a], [b]) => compare(a, b))),
      sourceRecordCopyCount: domain.source.records.length,
      webPresentationCount: domain.web.presentations.length,
      termLocalizationCount: domain.web.termLocalizations.length,
      announcementCount: domain.web.announcements.length,
      gameChangeCount: domain.web.gameChanges.length,
      officialTextChangeCount: domain.web.officialTextChanges.length,
      webReviewTargetCount: domain.web.reviewTargets.length,
    });
  }

  const technicalByIdentity = new Map();
  for (const record of technicalRecords) {
    if (!isObject(record) || typeof record.recordId !== 'string' || typeof record.gameReleaseId !== 'string'
      || typeof record.kind !== 'string') throw new Error('Source technical packet has a malformed record identity');
    const key = exactSourceIdentity(record);
    if (technicalByIdentity.has(key)) throw new Error('Source technical packet repeats a release-qualified record identity');
    technicalByIdentity.set(key, record);
  }
  if (technicalByIdentity.size !== copies.size) throw new Error('core-domain union does not match the technical packet record count');
  for (const [key, item] of copies) {
    const technicalRecord = technicalByIdentity.get(key);
    if (!technicalRecord || stableJson(technicalRecord) !== stableJson(item.record)) {
      throw new Error(`core-domain Source record does not exactly match technical packet: ${key.replace('\0', ':')}`);
    }
  }
  for (const key of technicalByIdentity.keys()) if (!copies.has(key)) {
    throw new Error(`technical packet record is missing from all core domains: ${key.replace('\0', ':')}`);
  }

  const records = [...copies.entries()].map(([key, value]) => ({
    gameReleaseId: value.record.gameReleaseId,
    recordId: value.record.recordId,
    kind: value.record.kind,
    domainCopies: value.domains.sort(compare),
    releaseClass: value.record.gameReleaseId === gameReleaseId ? 'current-review-release' : 'other-release-not-current',
  })).sort((left, right) => compare(`${left.gameReleaseId}\0${left.recordId}`, `${right.gameReleaseId}\0${right.recordId}`));
  return {
    domainCount: domainSummary.length,
    domains: domainSummary,
    recordCopyCount,
    uniqueRecordCount: records.length,
    currentRecordCount: records.filter(record => record.gameReleaseId === gameReleaseId).length,
    historicalRecordCount: records.filter(record => record.gameReleaseId !== gameReleaseId).length,
    webPresentationCount,
    termLocalizationCount,
    webReviewTargetCount,
    recordIdentities: records,
  };
}

/** Keep the historical source inventory separate from the smaller zh-TW reader projection. */
export function summarizeW14HistoryProjection({ manifest, index }) {
  const kinds = ['skills', 'weapons', 'blessings', 'marks', 'variants'];
  if (!isObject(manifest) || !isObject(manifest.projection) || !isObject(index)
    || !isObject(index.counts) || !Array.isArray(index.entries)) {
    throw new TypeError('pinned history manifest and player index are required');
  }
  const singularKinds = { skills: 'skill', weapons: 'weapon', blessings: 'blessing', marks: 'mark', variants: 'variant' };
  const actualCounts = Object.fromEntries(kinds.map(kind => [kind, 0]));
  for (const entry of index.entries) {
    const kind = kinds.find(candidate => singularKinds[candidate] === entry?.kind);
    if (!isObject(entry) || !kind) throw new Error('historical player index has an unsupported entry kind');
    actualCounts[kind]++;
  }
  const sourceCounts = {};
  const projectedCounts = {};
  const excludedCounts = {};
  const excludedReasons = {};
  for (const kind of kinds) {
    const source = index.counts[kind];
    const projected = manifest.projection.counts?.[kind];
    const excluded = manifest.projection.excludedCounts?.[kind];
    const reasons = manifest.projection.excludedReasons?.[kind];
    if (![source, projected, excluded].every(Number.isSafeInteger) || source < 0 || projected < 0 || excluded < 0
      || source !== projected + excluded || actualCounts[kind] !== projected || !isObject(reasons)
      || Object.values(reasons).some(count => !Number.isSafeInteger(count) || count < 0)
      || Object.values(reasons).reduce((sum, count) => sum + count, 0) !== excluded) {
      throw new Error(`historical ${kind} source/projected/excluded counts do not reconcile`);
    }
    sourceCounts[kind] = source;
    projectedCounts[kind] = projected;
    excludedCounts[kind] = excluded;
    excludedReasons[kind] = reasons;
  }
  return {
    sourceCounts,
    projectedCounts,
    excludedCounts,
    excludedReasons,
    sourceEntryCount: Object.values(sourceCounts).reduce((sum, count) => sum + count, 0),
    projectedEntryCount: index.entries.length,
  };
}

function parseCli(args) {
  const result = {};
  for (let index = 0; index < args.length; index++) {
    const key = args[index];
    if (!key.startsWith('--')) throw new Error(`unexpected argument: ${key}`);
    if (key === '--check') { result.check = true; continue; }
    const value = args[++index];
    if (!value || value.startsWith('--')) throw new Error(`missing value for ${key}`);
    const name = key.slice(2);
    if (result[name]) throw new Error(`duplicate argument: ${key}`);
    result[name] = value;
  }
  return result;
}

function resolveArchiveInput(sourceRoot, manifestPath, label, expectedCount) {
  const bytes = readGitBlob(sourceRoot, SOURCE_ARCHIVE_COMMIT, manifestPath, 8 * 1024 * 1024);
  const manifest = decodeJson(bytes, `${label} archive manifest`);
  if (!isObject(manifest) || manifest.schemaVersion !== 'w14.extension-legacy-archive.v1'
    || manifest.archiveRole !== 'historical-extension-input-preservation'
    || manifest.currentApproval !== 'not-current-approved' || manifest.sourceSelection !== 'pinned-git-objects-only'
    || manifest.protectedWorkingTreeBodiesRead !== false || manifest.fileCount !== expectedCount
    || !Array.isArray(manifest.files) || manifest.files.length !== expectedCount) {
    throw new Error(`${label} archive manifest does not match the exact read-only historical archive contract`);
  }
  const archivePrefix = path.posix.dirname(manifestPath);
  const rows = [];
  const seen = new Set();
  for (const file of manifest.files) {
    if (!isObject(file) || typeof file.sourcePath !== 'string' || seen.has(file.sourcePath)
      || typeof file.archivePath !== 'string' || file.archivePath.startsWith('/')
      || file.archivePath.split('/').some(piece => !piece || piece === '.' || piece === '..')) {
      throw new Error(`${label} archive contains a duplicate or unsafe source/archive path`);
    }
    seen.add(file.sourcePath);
    const compressedPath = `${archivePrefix}/${file.archivePath}`;
    const compressed = readGitBlob(sourceRoot, SOURCE_ARCHIVE_COMMIT, compressedPath, 32 * 1024 * 1024);
    if (compressed.length !== file.compressedBytes || sha256(compressed) !== file.compressedSha256) {
      throw new Error(`${label} archived payload bytes differ from the pinned manifest: ${file.sourcePath}`);
    }
    let raw;
    try { raw = gunzipSync(compressed, { maxOutputLength: file.byteLength + 1 }); }
    catch { throw new Error(`${label} archived payload is not a bounded gzip file: ${file.sourcePath}`); }
    if (raw.length !== file.byteLength || sha256(raw) !== file.sha256 || gitBlobOid(raw) !== file.gitBlobOid) {
      throw new Error(`${label} raw archived bytes differ from the fixed source Git object: ${file.sourcePath}`);
    }
    const row = {
      sourceCommit: file.sourceCommit,
      sourcePath: file.sourcePath,
      sourceGitBlobOid: file.gitBlobOid,
      sourceSha256: file.sha256,
      sourceByteLength: file.byteLength,
      archivePath: file.archivePath,
      compressedSha256: file.compressedSha256,
      compressedBytes: file.compressedBytes,
      w03RowCount: 0,
      archiveDisposition: 'historical-read-only-no-current-approval',
      inputRole: classifyArchivedExtensionInput(file.sourcePath),
      currentMappingRule: 'no current target is inferred from filename, domain label, or text similarity; use exact W03 row and approved-target evidence',
      versionEvidence: null,
    };
    if (file.sourcePath.startsWith('data/') && file.sourcePath.endsWith('.json')
      && !file.sourcePath.endsWith('/review-approvals.json')
      && !file.sourcePath.endsWith('/reviewed-abilities.json')) {
      const data = decodeJson(raw, `${label} archived input ${file.sourcePath}`);
      const values = [data.provenance?.release, data.provenance?.sourceBuild, data.basedOn?.sourceBuild,
        data.basedOn?.release, data.provenance?.sourceRevision, data.basedOn?.sourceRevision,
        data.provenance?.catalogSha256, data.basedOn?.catalogSha256].filter(value => typeof value === 'string');
      const explicitOneThirteenOne = values.some(value => value === '1.13.1' || value === 'SteamBuild_25606770_1.13.1');
      row.versionEvidence = {
        declarationFields: {
          release: data.provenance?.release ?? data.basedOn?.release ?? null,
          sourceBuild: data.provenance?.sourceBuild ?? data.basedOn?.sourceBuild ?? null,
          sourceRevision: data.provenance?.sourceRevision ?? data.basedOn?.sourceRevision ?? null,
          catalogSha256: data.provenance?.catalogSha256 ?? data.basedOn?.catalogSha256 ?? null,
        },
        classification: explicitOneThirteenOne ? 'explicit-historical-1.13.1-declaration' : 'no-explicit-1.13.1-declaration-in-scanned-provenance-fields',
        fieldsInspected: ['provenance.release', 'provenance.sourceBuild', 'provenance.sourceRevision', 'provenance.catalogSha256',
          'basedOn.release', 'basedOn.sourceBuild', 'basedOn.sourceRevision', 'basedOn.catalogSha256'],
      };
    }
    rows.push(row);
  }
  return {
    manifest: {
      repository: 'SyuanTsai/DarkTide-Source-Data',
      sourceScopeRepository: manifest.sourceScope?.repository ?? null,
      sourceScopeManifestPath: manifest.sourceScope?.scopeManifestPath ?? null,
      sourceScopeManifestSha256: manifest.sourceScope?.scopeManifestSha256 ?? null,
      commit: SOURCE_ARCHIVE_COMMIT,
      path: manifestPath,
      gitBlobOid: gitBlobOid(bytes),
      byteLength: bytes.length,
      sha256: sha256(bytes),
      fileCount: manifest.fileCount,
      rawBytes: manifest.rawBytes,
      compressedBytes: manifest.compressedBytes,
      w03ScopeManifestSha256: manifest.sourceScope?.scopeManifestSha256 ?? null,
      protectedWorkingTreeBodiesReadByArchive: manifest.protectedWorkingTreeBodiesRead,
    },
    rows,
  };
}

function archiveGuides(archiveRows) {
  const guideFile = archiveRows.rows.find(row => row.sourcePath === 'data/v1/mechanics/player-guides.json');
  if (!guideFile) throw new Error('fixed Extension archive is missing the historical player-guides file');
  const compressed = readGitBlob(archiveRows.sourceRoot, SOURCE_ARCHIVE_COMMIT,
    `content/legacy/w14/extension-inputs/${guideFile.archivePath}`, 8 * 1024 * 1024);
  const raw = gunzipSync(compressed, { maxOutputLength: guideFile.sourceByteLength + 1 });
  const guides = decodeJson(raw, 'fixed historical player-guides archive').records;
  if (!Array.isArray(guides) || guides.length !== 631) throw new Error('historical player-guide inventory is not exactly 631 records');
  const approvalShaSet = new Set(['0627d999010b6d42e305f0d692c3535c5833515cee58bdfec166c8f574d95b50',
    '4b06b82c451c7a5ee33b7aa60bf53e3429efb99aadb47b731611a649617b2f01']);
  const bySourceApproval = new Map();
  const headingCounts = new Map();
  const inventory = guides.map(guide => {
    if (!isObject(guide) || typeof guide.key !== 'string' || typeof guide.source?.approvalSha256 !== 'string'
      || !/^[a-f0-9]{64}$/u.test(guide.source?.textSha256 ?? '')
      || !approvalShaSet.has(guide.source.approvalSha256) || !Array.isArray(guide.sections)) {
      throw new Error('historical player guide has missing identity or unpinned approval dependency');
    }
    const approvalRows = bySourceApproval.get(guide.source.approvalSha256) ?? 0;
    bySourceApproval.set(guide.source.approvalSha256, approvalRows + 1);
    const headings = guide.sections.map(section => {
      if (typeof section?.heading !== 'string' || !Array.isArray(section.paragraphs)) {
        throw new Error(`historical player guide has a malformed section: ${guide.key}`);
      }
      headingCounts.set(section.heading, (headingCounts.get(section.heading) ?? 0) + 1);
      return { heading: section.heading, paragraphCount: section.paragraphs.length };
    });
    return {
      key: guide.key,
      sourceCategory: guide.source.category ?? null,
      sourceIdentityId: guide.source.identity?.id ?? null,
      sourceApprovalSha256: guide.source.approvalSha256,
      sourceTextSha256: guide.source.textSha256,
      sectionInventory: headings,
      paragraphCount: headings.reduce((count, section) => count + section.paragraphCount, 0),
      guideTextIncluded: false,
      currentApprovalCarryForward: false,
    };
  }).sort((left, right) => compare(left.key, right.key));
  if (bySourceApproval.get('0627d999010b6d42e305f0d692c3535c5833515cee58bdfec166c8f574d95b50') !== 618
    || bySourceApproval.get('4b06b82c451c7a5ee33b7aa60bf53e3429efb99aadb47b731611a649617b2f01') !== 13) {
    throw new Error('historical player-guide approval dependencies differ from the pinned 618/13 split');
  }
  return {
    sourcePath: guideFile.sourcePath,
    rawSha256: guideFile.sourceSha256,
    byteLength: guideFile.sourceByteLength,
    recordCount: inventory.length,
    approvalDependencies: [
      { sha256: '0627d999010b6d42e305f0d692c3535c5833515cee58bdfec166c8f574d95b50', sourcePath: 'data/v1/mechanics/reviewed-abilities.json', guideCount: 618, declaredGameBuild: 'SteamBuild_25606770_1.13.1' },
      { sha256: '4b06b82c451c7a5ee33b7aa60bf53e3429efb99aadb47b731611a649617b2f01', sourcePath: 'data/v1/blessing-mechanics.json', guideCount: 13, declaredGameBuild: 'SteamBuild_25606770_1.13.1' },
    ],
    sectionHeadingCounts: Object.fromEntries([...headingCounts].sort(([a], [b]) => compare(a, b))),
    guides: inventory,
    versionStatus: 'historical-1.13.1-approval-dependencies; no carry-forward to current 1.13.2',
  };
}

async function loadW03Facts(webRoot) {
  const groups = new Map();
  const byOwnerScope = new Map();
  const archiveRowsBySource = new Map();
  const hardcodedRows = [];
  const walk = await walkW03LedgerShards({
    docRoot: path.join(webRoot, 'docs/contracts/w03'),
    onShard: async ({ descriptor, entries }) => {
      for (const entry of entries) {
        const group = groups.get(descriptor.groupId) ?? { entryCount: 0, sourcePaths: new Set() };
        group.entryCount++;
        group.sourcePaths.add(entry.source.path);
        groups.set(descriptor.groupId, group);
        const ownerScopeKey = `${entry.owner}\0${entry.scope.releaseScope}`;
        byOwnerScope.set(ownerScopeKey, (byOwnerScope.get(ownerScopeKey) ?? 0) + 1);
        if (entry.groupId === 'extension-additional-data' || descriptor.groupId === 'extension-additional-data'
          || descriptor.groupId === 'extension-release-inputs') {
          archiveRowsBySource.set(entry.source.path, (archiveRowsBySource.get(entry.source.path) ?? 0) + 1);
        }
        if (descriptor.groupId === 'extension-hardcoded-content-candidates') {
          hardcodedRows.push({
            entryId: entry.entryId,
            source: entry.source,
            selector: entry.selector,
            sourceFragmentSha256: entry.fragment?.sha256 ?? null,
            sourceScope: entry.scope,
            target: entry.target,
            currentApproval: 'none-inferred-from-hardcoded-source',
          });
        }
      }
    },
  });
  if (walk.sourceLedgerSha256 !== W03_LEDGER_SHA256 || walk.entryCount !== A_EXPECTED_COUNT) {
    throw new Error('frozen W03 A ledger differs from its expected full inventory');
  }
  return {
    walk,
    groups: Object.fromEntries([...groups].sort(([a], [b]) => compare(a, b)).map(([groupId, item]) => [groupId, {
      entryCount: item.entryCount, sourcePathCount: item.sourcePaths.size,
    }])),
    byOwnerScope: Object.fromEntries([...byOwnerScope].sort(([a], [b]) => compare(a, b))
      .map(([key, count]) => [key.split('\0'), count])),
    archiveRowsBySource,
    hardcodedRows: hardcodedRows.sort((a, b) => compare(a.entryId, b.entryId)),
  };
}

function verifyModsIndex(webRoot) {
  const bytes = readFileSync(path.join(webRoot, 'docs/contracts/w03/mods/mapping-ledger.json'));
  if (sha256(bytes) !== W03_MODS_LEDGER_SHA256) throw new Error('fixed W03 Mods index SHA-256 mismatch');
  const index = decodeJson(bytes, 'W03 Mods index');
  if (index.format !== 'w03-mods-mapping-ledger.v1' || index.entryCount !== MODS_EXPECTED_COUNT) {
    throw new Error('fixed W03 Mods index has an unexpected format or count');
  }
  return { bytes, index };
}

function buildModsMatrix(index, privateSummary, m01ManifestBytes) {
  const groupDisposition = {
    M01: { status: 'archived-readable', destination: 'Source content/legacy/mods/241ad76/ Game Info archive', currentData: false },
    M02: { status: 'private-restorable', destination: 'restricted private preservation archive; public-safe receipt only', currentData: false },
    M03: { status: 'private-restorable', destination: 'restricted private preservation archive; public-safe receipt only', currentData: false },
    M04: { status: 'private-restorable', destination: 'restricted private preservation archive; public-safe receipt only', currentData: false },
    M05: { status: 'deferred-w15', destination: null, currentData: false },
    M06: { status: 'deferred-w15', destination: null, currentData: false },
    M07: { status: 'deferred-w15', destination: null, currentData: false },
    M08: { status: 'deferred-w15', destination: null, currentData: false },
    K01: { status: 'kept-at-original-mods-owner', destination: 'fixed Mods Git commit/blob only', currentData: false },
    K02: { status: 'kept-at-original-mods-owner', destination: 'fixed Mods Git commit/blob only', currentData: false },
  };
  const groupRows = index.groups.map(group => ({
    groupId: group.groupId,
    sourcePathCount: group.sourcePathCount,
    entryCount: group.entryCount,
    sourceInventorySha256: group.sourceInventorySha256,
    w14: groupDisposition[group.groupId] ?? { status: 'unclassified', destination: null, currentData: false },
  })).sort((a, b) => compare(a.groupId, b.groupId));
  if (groupRows.some(group => group.w14.status === 'unclassified')) throw new Error('W03 Mods contains an unclassified group');
  const privateSafe = {
    summaryPath: 'docs/contracts/w14/private-preservation-public-summary.json',
    summarySha256: sha256(privateSummary.bytes),
    sourceCommit: privateSummary.document.sourceCommit,
    modsLedgerSha256: privateSummary.document.modsLedgerSha256,
    scopeGroups: privateSummary.document.scopeGroups,
    scopeInventorySha256: privateSummary.document.scopeInventorySha256,
    sourcePathCount: privateSummary.document.sourcePathCount,
    archiveBytes: privateSummary.document.archiveBytes,
    archiveSha256: privateSummary.document.archiveSha256,
    manifestBytes: privateSummary.document.manifestBytes,
    manifestSha256: privateSummary.document.manifestSha256,
    allHashesAndFixedTreeMembershipVerified: privateSummary.document.allCrcAndSha256AndGitBlobHashesVerified
      && privateSummary.document.fixedGitTreeMembershipVerified,
    restoredSampleFiles: privateSummary.document.freshRestoredSampleFiles,
    fullRestoreClaimed: privateSummary.document.fullRestoreClaimed,
    bodyIncluded: false,
    privateLocatorIncluded: false,
  };
  if (privateSafe.modsLedgerSha256 !== W03_MODS_LEDGER_SHA256 || privateSafe.sourcePathCount !== 79014
    || privateSafe.fullRestoreClaimed !== false || privateSafe.restoredSampleFiles !== 11
    || privateSafe.allHashesAndFixedTreeMembershipVerified !== true) {
    throw new Error('public-safe private preservation summary does not match the verified bounded restoration receipt');
  }
  return {
    ledgerSha256: W03_MODS_LEDGER_SHA256,
    entryCount: index.entryCount,
    sourcePathCount: index.source.pathCount,
    sourceCommit: index.source.commit,
    groups: groupRows,
    m01: {
      manifestPath: 'content/legacy/mods/241ad76/m01-manifest.json',
      manifestSha256: sha256(m01ManifestBytes),
      groupRows: groupRows.find(group => group.groupId === 'M01').entryCount,
      rawFiles: 3071,
      rawBytes: 25070107,
      currentApproval: 'not-current-approved',
      releaseStatus: 'unverified',
    },
    privatePreservation: privateSafe,
    w15DeferredGroups: ['M05', 'M06', 'M07', 'M08'],
    retainedModsGroups: ['K01', 'K02'],
  };
}

function markdownForMatrix(matrix) {
  const table = (headers, rows) => [
    `| ${headers.join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`,
    ...rows.map(row => `| ${row.map(value => String(value ?? '').replace(/\|/gu, '\\|').replace(/\r?\n/gu, ' ')).join(' | ')} |`),
  ].join('\n');
  const lines = [
    '# W14 domain and migration coverage matrix', '',
    'This generated matrix inventories the fixed current package, archived Extension inputs, W03 scope, registry, history, and scoped Mods outcomes. It is an audit locator; it does not create approvals or claim registry player availability.', '',
    '## Current reviewed package', '',
    `- Game release: \`${matrix.current.gameReleaseId}\` (build ${matrix.current.gameBuild}).`,
    `- Runtime content version: \`${matrix.current.activeRuntime.contentVersion}\`; data revision \`${matrix.current.activeRuntime.dataRevision}\`; manifest SHA-256 \`${matrix.current.activeRuntime.manifestSha256}\`.`,
    `- Source review basis: \`${matrix.current.sourceReviewBasis.sourceRevision}\`; source technical packet SHA-256 \`${matrix.current.sourceReviewBasis.technicalSha256}\`; ${matrix.current.sourceReviewBasis.currentApprovedTargetCount} current Source targets (${matrix.current.sourceReviewBasis.historicalApprovedTargetCount} target receipts are 1.13.1 history).`,
    `- W13 prepared candidate is pinned at ${matrix.current.reviewCandidate.commit}:${matrix.current.reviewCandidate.path}, is publicationEligible=${matrix.current.reviewCandidate.publicationEligible}, and is not a selection or publication action.`,
    `- The pinned candidate records ${matrix.current.reviewCandidate.approvedTargetCount} approved targets from ${matrix.current.reviewCandidate.receiptCount} receipts (${matrix.current.reviewCandidate.sourceTargets} Source targets, including history, and ${matrix.current.reviewCandidate.webTargets} Web targets); it remains candidate-only.`,
    '',
    table(['Core domain', 'Source records', 'Current record copies', 'Web presentations', 'Term localizations', 'Web review targets', 'Raw SHA-256'], matrix.current.sharedDomains.map(domain => [
      domain.name, domain.sourceRecordCopyCount, domain.currentRecordCopyCount, domain.webPresentationCount,
      domain.termLocalizationCount, domain.webReviewTargetCount, domain.sha256,
    ])),
    '',
    table(['Shared domain', 'Player display owner identities', 'Term localization identities'], matrix.current.sharedDomains.map(domain => [
      domain.name,
      domain.displayOwners.presentations.map(item => `${item.authoringId} → ${item.entityRef?.recordId ?? 'unresolved'}`).join('; ') || 'none',
      domain.displayOwners.termLocalizations.map(item => `${item.authoringId} → ${item.termRef?.recordId ?? 'unresolved'}`).join('; ') || 'none',
    ])),
    '',
    `The four domains contain ${matrix.current.sharedPackage.recordCopyCount} Source record copies and ${matrix.current.sharedPackage.uniqueRecordCount} unique release-qualified records (${matrix.current.sharedPackage.currentRecordCount} current and ${matrix.current.sharedPackage.historicalRecordCount} other-release records). The exact identity inventory is in the JSON matrix.`,
    '',
    `W03 current-candidate reconciliation: ${matrix.current.w03CurrentRows.total} rows (${matrix.current.w03CurrentRows.source} Source / ${matrix.current.w03CurrentRows.web} Web); ${matrix.current.w03CurrentRows.unresolved} unresolved rows in the fixed reconciliation reports and ${matrix.current.w03CurrentRows.deferredW15} announcement rows deferred to W15. This result is limited to the frozen W03 current-candidate scope.`,
    '',
    'The W03 weapon registry has 57 groups and 203 members. Three members match exact current Source `payload.templateKey` identities and have pinned approved digest evidence. The remaining 200 are registry-only in this package; this matrix does not infer game absence or player availability.',
    '',
    '## Archived Extension domains', '',
    'The 26-file and nine-file Extension batches are exact pinned-object preservation archives owned by Source. They are not current approval or an inferred snapshot mapping. The per-file list records every source hash and only provenance fields actually present in each archived input.', '',
    table(['Archive', 'Files', 'Raw bytes', 'W03 rows', 'Manifest SHA-256'], matrix.extensionArchives.map(archive => [
      archive.label, archive.fileCount, archive.rawBytes, archive.w03Rows, archive.manifest.sha256,
    ])),
    '',
    table(['Archived Extension input', 'Input role', 'Version evidence', 'W03 rows', 'Raw SHA-256'], matrix.extensionArchives.flatMap(archive => archive.files).map(file => [
      file.sourcePath, file.inputRole, file.versionEvidence?.classification ?? 'no release declaration or separately pinned version dependency',
      file.w03RowCount, file.sourceSha256,
    ])),
    '',
    `The historical player-guides inventory has ${matrix.extensionDomains.playerGuides.recordCount} rows: 618 ability guides depend on the fixed reviewed-abilities SHA-256 and 13 blessing guides depend on the fixed blessing-mechanics SHA-256. Both dependencies declare SteamBuild_25606770_1.13.1; this is historical, not current approval. Guide text is not duplicated in this matrix.`,
    '',
    `Five hardcoded-content rows remain exact pinned Extension source-code references with no formal gameReleaseId; they are not current translated records.`,
    '',
    '## W03 A ledger and Mods ledger', '',
    table(['W03 A group', 'Rows', 'Source paths'], Object.entries(matrix.ledgers.a.groups).map(([name, item]) => [name, item.entryCount, item.sourcePathCount])),
    '',
    table(['Mods group', 'Rows', 'Source paths', 'W14 disposition'], matrix.ledgers.mods.groups.map(group => [
      group.groupId, group.entryCount, group.sourcePathCount, group.w14.status,
    ])),
    '',
    `The public M01 archive holds 3,071 files / 107,060 W03 rows. M02/M03/M04 have a restricted preservation archive for 79,014 paths; all archive/file hashes and fixed tree membership were verified, with 11 fresh sample restores. The receipt explicitly does not claim a full restore. M05–M08 are deferred to W15; K01/K02 remain at the fixed Mods owner.`,
    '',
    '## Historical Web player index', '',
    `The read-only /history/1.13.1 projection binds to Web commit ${matrix.history.source.commit}, original source content SHA-256 ${matrix.history.source.sha256}, and player-index SHA-256 ${matrix.history.projection.sha256}. The source inventory is ${matrix.history.sourceCounts.skills} skills, ${matrix.history.sourceCounts.weapons} weapons, ${matrix.history.sourceCounts.blessings} blessings, ${matrix.history.sourceCounts.marks} marks, and ${matrix.history.sourceCounts.variants} variants. The Traditional Chinese player projection contains ${matrix.history.projection.counts.skills} skills, ${matrix.history.projection.counts.weapons} weapons, ${matrix.history.projection.counts.blessings} blessings, ${matrix.history.projection.counts.marks} marks, and ${matrix.history.projection.counts.variants} variants; ${matrix.history.projection.excludedCounts.skills + matrix.history.projection.excludedCounts.weapons + matrix.history.projection.excludedCounts.blessings + matrix.history.projection.excludedCounts.marks + matrix.history.projection.excludedCounts.variants} entries without a verified Traditional Chinese name are excluded and listed in the manifest.`,
    '',
    '## Scope limits', '',
    '- The matrix reconciles the frozen W03 scope and current reviewed package; it does not claim the full game catalog is covered by the 260-entry registry or the 230 current Source records.',
    '- Historical Extension inputs without an explicit version declaration remain version-unspecified; filenames and similar text are not used to assign a game release.',
    '- No W15–W17 content is migrated here. The overlay manifest and per-row dispositions are generated separately.',
    '',
  ];
  return `${lines.join('\n').replace(/\n+$/u, '')}\n`;
}

export async function buildW14DomainMatrix({ webRoot, sourceRoot, technicalJsonPath, privateSummaryPath, outputPath }) {
  for (const [name, value] of Object.entries({ webRoot, sourceRoot, technicalJsonPath, privateSummaryPath, outputPath })) {
    if (typeof value !== 'string' || !value) throw new TypeError(`${name} is required`);
  }
  const technicalBytes = await readFile(technicalJsonPath);
  if (sha256(technicalBytes) !== W13_SOURCE_TECHNICAL_SHA256) throw new Error('W13 Source technical packet raw SHA-256 does not match the fixed release asset');
  const technical = decodeJson(technicalBytes, 'W13 Source technical packet');
  if (technical.schemaVersion !== '2.0.0' || technical.publicationEligible !== true
    || !Array.isArray(technical.records) || technical.records.length !== 236
    || !Array.isArray(technical.reviewReceipts) || technical.reviewReceipts.length !== 823
    || !Array.isArray(technical.sourceRefs) || technical.sourceRefs.length !== 174) {
    throw new Error('W13 Source technical packet has unexpected release, record, receipt, or source-reference facts');
  }

  const candidateBytes = readGitBlob(webRoot, WEB_W13_COMMIT, W13_CANDIDATE_PATH, 4 * 1024 * 1024);
  if (sha256(candidateBytes) !== W13_CANDIDATE_SHA256 || gitBlobOid(candidateBytes) !== W13_CANDIDATE_BLOB
    || candidateBytes.length !== 1059353) throw new Error('fixed W13 owner candidate commit/path/blob/size/SHA mismatch');
  const candidate = decodeJson(candidateBytes, 'fixed W13 owner candidate');
  if (candidate.releaseId !== W13_RELEASE_ID || candidate.source?.requestId !== W13_REQUEST_ID
    || candidate.source?.sourceRevision !== W13_SOURCE_REVISION || candidate.manifest?.dataRevision !== W13_DATA_REVISION
    || candidate.manifest?.sha256 !== W13_MANIFEST_SHA256
    || candidate.gameReleaseId !== W13_GAME_RELEASE_ID || candidate.contentVersion !== W13_CURRENT_CONTENT_VERSION
    || candidate.candidateOnly !== true || candidate.publicationEligible !== false
    || candidate.source?.releaseId !== 'w09-810d0f41e9904265b7c53f4d2c610eab'
    || candidate.source?.archiveSha256 !== 'ae6137c70e9ea197f8f077a141511ac321f1179b1a18554870f2539ea72ef03c'
    || candidate.review?.receiptCount !== 908 || candidate.review?.targetCount !== 903
    || candidate.review?.sourceTargetCount !== 823 || candidate.review?.webTargetCount !== 80
    || candidate.review?.states?.approved !== 903 || candidate.review?.states?.pending !== 0
    || candidate.review?.states?.rejected !== 0 || candidate.review?.states?.stale !== 0) {
    throw new Error('fixed W13 candidate identity or candidate-only status mismatch');
  }

  const domainBase = `content/contracts/w09/prepared/${W13_RELEASE_ID}/data/${W13_DATA_REVISION}`;
  const domains = {};
  const domainFiles = [];
  for (const name of CORE_DOMAIN_NAMES) {
    const repoPath = `${domainBase}/domains/${name}.json`;
    const bytes = readGitBlob(webRoot, WEB_W13_COMMIT, repoPath, 16 * 1024 * 1024);
    const pin = W13_CORE_DOMAIN_PINS[name];
    if (bytes.length !== pin.byteLength || sha256(bytes) !== pin.sha256 || gitBlobOid(bytes) !== pin.gitBlobOid) {
      throw new Error(`pinned W13 ${name} domain bytes do not match`);
    }
    const domain = decodeJson(bytes, `pinned W13 ${name} domain`);
    if (domain.kind !== name || domain.schemaVersion !== 'w08-shared-domain/1.0.0'
      || domain.gameReleaseId !== W13_GAME_RELEASE_ID) throw new Error(`pinned W13 ${name} domain identity mismatch`);
    domains[name] = domain;
    domainFiles.push({
      name, path: repoPath, commit: WEB_W13_COMMIT, gitBlobOid: gitBlobOid(bytes),
      byteLength: bytes.length, sha256: sha256(bytes),
      sourceRecordCopyCount: domain.source.records.length,
      currentRecordCopyCount: domain.source.records.filter(record => record.gameReleaseId === W13_GAME_RELEASE_ID).length,
      webPresentationCount: domain.web.presentations.length,
      termLocalizationCount: domain.web.termLocalizations.length,
      webReviewTargetCount: domain.web.reviewTargets.length,
      kindCounts: domain.source.records.reduce((counts, record) => {
        counts[record.kind] = (counts[record.kind] ?? 0) + 1;
        return counts;
      }, {}),
    });
  }
  const sharedPackage = summarizeW14SharedPackage({ domains, technicalRecords: technical.records, gameReleaseId: W13_GAME_RELEASE_ID });

  const w03 = await loadW03Facts(webRoot);
  const currentSourceReport = decodeJson(await readFile(path.join(webRoot, 'docs/contracts/w14/source-current-row-reconciliation.json')), 'Source current-row report');
  const currentWebReportBytes = await readFile(path.join(webRoot, 'docs/contracts/w14/web-current-row-reconciliation.json'));
  const currentWebReport = decodeJson(currentWebReportBytes, 'Web current-row report');
  const currentSourceReportBytes = await readFile(path.join(webRoot, 'docs/contracts/w14/source-current-row-reconciliation.json'));
  const registryReportBytes = await readFile(path.join(webRoot, 'docs/contracts/w14/weapon-registry-current-reconciliation.json'));
  const registryReport = decodeJson(registryReportBytes, 'weapon registry reconciliation report');
  if (currentSourceReport.rowCount !== 6840 || currentSourceReport.summary?.unresolvedCount !== 0
    || currentSourceReport.candidateOnly !== true || currentSourceReport.noApprovalCreated !== true
    || currentWebReport.rowCount !== 568 || currentWebReport.summary?.currentGapCount !== 0
    || currentWebReport.candidateOnly !== true || currentWebReport.noApprovalCreated !== true
    || registryReport.summary?.registryEntries !== 260 || registryReport.summary?.memberEntries !== 203
    || registryReport.summary?.unmatchedMembers !== 200 || registryReport.summary?.playerAvailabilityInferred !== false) {
    throw new Error('fixed current reconciliation reports do not match their pinned row counts and claim limits');
  }
  const currentW03Rows = w03.walk.countsByGroup['source-w01-candidates'] + w03.walk.countsByGroup['web-w01-inputs']
    + w03.walk.countsByGroup['web-source-lock'];
  if (currentW03Rows !== 7581) {
    // The current release-scope filter omits 173 non-current W01 rows; the row reports bind its exact 7,408 subset.
    if (currentSourceReport.rowCount + currentWebReport.rowCount !== 7408) throw new Error('current-row reports do not cover the exact 7,408-row W03 current subset');
  }

  const sourceArchive26 = resolveArchiveInput(sourceRoot, 'content/legacy/w14/extension-inputs/manifest.json', '26-file Extension', 26);
  const sourceArchive9 = resolveArchiveInput(sourceRoot, 'content/legacy/w14/extension-additional-inputs/manifest.json', 'nine-file Extension', 9);
  sourceArchive26.sourceRoot = sourceRoot;
  sourceArchive9.sourceRoot = sourceRoot;
  const guideInventory = archiveGuides(sourceArchive26);
  const archiveRows = [...sourceArchive26.rows, ...sourceArchive9.rows];
  for (const dependency of guideInventory.approvalDependencies) {
    const dependencyRow = archiveRows.find(row => row.sourcePath === dependency.sourcePath);
    if (!dependencyRow || dependencyRow.sourceSha256 !== dependency.sha256) {
      throw new Error(`historical guide approval dependency does not match its exact archived input: ${dependency.sourcePath}`);
    }
    dependencyRow.versionEvidence = {
      classification: 'explicit-1.13.1-player-guide-approval-dependency',
      declaredGameBuild: dependency.declaredGameBuild,
      dependentGuideCount: dependency.guideCount,
      approvalSha256: dependency.sha256,
      sourceInputSha256: dependencyRow.sourceSha256,
      sourceInputGitBlobOid: dependencyRow.sourceGitBlobOid,
      derivedFromExactGuideApprovalReferences: true,
    };
  }
  for (const row of archiveRows) row.w03RowCount = w03.archiveRowsBySource.get(row.sourcePath) ?? 0;
  if (archiveRows.filter(row => row.sourcePath.startsWith('data/')).length < 17
    || archiveRows.some(row => row.w03RowCount === 0 && row.sourcePath.startsWith('data/'))) {
    throw new Error('archived Extension data input is not fully bound to a frozen W03 row');
  }

  const sourceRefEvidence = decodeJson(await readFile(path.join(webRoot, 'docs/contracts/w14/weapon-registry-current-reconciliation.json')), 'registry report');
  const webHistoryManifestBytes = await readFile(path.join(webRoot, 'content/history/1.13.1/manifest.json'));
  const webHistoryIndexBytes = await readFile(path.join(webRoot, 'content/history/1.13.1/player-index.json'));
  const webHistoryManifest = decodeJson(webHistoryManifestBytes, 'historical player manifest');
  const webHistoryIndex = decodeJson(webHistoryIndexBytes, 'historical player index');
  if (webHistoryManifest.gameVersion !== '1.13.1' || webHistoryManifest.projection?.sha256 !== sha256(webHistoryIndexBytes)
    || webHistoryManifest.projection?.byteLength !== webHistoryIndexBytes.length || webHistoryIndex.gameVersion !== '1.13.1') {
    throw new Error('fixed Web history player projection is not bound to its exact version and raw bytes');
  }
  const historyProjection = summarizeW14HistoryProjection({ manifest: webHistoryManifest, index: webHistoryIndex });
  const extensionRoot = sourceRoot;
  const m01Bytes = readGitBlob(extensionRoot, SOURCE_ARCHIVE_COMMIT, 'content/legacy/mods/241ad76/m01-manifest.json', 4 * 1024 * 1024);
  const m01Manifest = decodeJson(m01Bytes, 'M01 archive manifest');
  if (m01Manifest.schema !== 'w14.m01-mods-legacy-archive/1' || m01Manifest.fileCount !== 3071
    || m01Manifest.mapping?.rowCount !== 107060 || m01Manifest.mapping?.sourceLedgerSha256 !== W03_MODS_LEDGER_SHA256
    || m01Manifest.inventorySha256 !== 'ee841b36463248003cf490344979170fb67b860ea39b70295dcc4c65a8de3307') {
    throw new Error('M01 Source archive does not bind the fixed W03 Mods scope');
  }
  const mods = verifyModsIndex(webRoot);
  const privateSummaryBytes = await readFile(privateSummaryPath);
  const privateSummary = decodeJson(privateSummaryBytes, 'public-safe private preservation receipt');
  const modsMatrix = buildModsMatrix(mods.index, { bytes: privateSummaryBytes, document: privateSummary }, m01Bytes);
  const hardcoded = w03.hardcodedRows;
  if (hardcoded.length !== 5 || hardcoded.some(row => row.source.commit !== 'b18f5ee2d7c9886b1d9ecb56f7ece8fca5d32c9a'
    || !['extension/core.js', 'extension/content.js'].includes(row.source.path))) {
    throw new Error('five frozen Extension hardcoded references differ from the fixed W03 source objects');
  }

  const currentReceipts = technical.reviewReceipts.filter(receipt => receipt.target?.gameReleaseId === W13_GAME_RELEASE_ID
    && receipt.decision === 'approved' && /^[a-f0-9]{64}$/u.test(receipt.targetDigest ?? '')
    && /^[a-f0-9]{64}$/u.test(receipt.dependenciesDigest ?? ''));
  const otherReceipts = technical.reviewReceipts.filter(receipt => receipt.target?.gameReleaseId !== W13_GAME_RELEASE_ID);
  if (currentReceipts.length !== 817 || otherReceipts.length !== 6) throw new Error('W13 selected Source receipt release split is not 817 current / 6 historical');
  const recordsByIdentity = new Map(technical.records.map(record => [exactSourceIdentity(record), record]));
  const currentRecords = [...recordsByIdentity.values()].filter(record => record.gameReleaseId === W13_GAME_RELEASE_ID);
  const nonCurrentRecords = [...recordsByIdentity.values()].filter(record => record.gameReleaseId !== W13_GAME_RELEASE_ID);
  const currentIdentityInventory = [...recordsByIdentity.values()].map(record => ({
    recordId: record.recordId,
    kind: record.kind,
    gameReleaseId: record.gameReleaseId,
    releaseClass: record.gameReleaseId === W13_GAME_RELEASE_ID ? 'current-1.13.2' : 'historical-not-current',
    approvedTargetCount: technical.reviewReceipts.filter(receipt => receipt.target?.recordId === record.recordId
      && receipt.target?.gameReleaseId === record.gameReleaseId && receipt.decision === 'approved').length,
  })).sort((a, b) => compare(`${a.gameReleaseId}\0${a.recordId}`, `${b.gameReleaseId}\0${b.recordId}`));

  const matrix = {
    schemaVersion: W14_DOMAIN_MATRIX_SCHEMA,
    status: 'fixed-scope-matrix; no new approval created; per-row outcome overlay is a separate artifact',
    w14Scope: {
      spec: 'SYP-311 v17 B/F; W14; W15-W17 deferred',
      currentGameReleaseId: W13_GAME_RELEASE_ID,
      currentGameBuild: '25681127',
      userFacingClaimLimit: 'The current domain matrix covers fixed W03 current-snapshot rows and the exact W13 reviewed package only. It does not infer a complete game catalog from Source registry membership or historical input volume.',
    },
    current: {
      gameReleaseId: W13_GAME_RELEASE_ID,
      gameVersion: '1.13.2',
      gameBuild: '25681127',
      activeRuntime: {
        contentVersion: W13_CURRENT_CONTENT_VERSION,
        dataRevision: W13_DATA_REVISION,
        manifestSha256: W13_MANIFEST_SHA256,
        verification: 'W13 live HTTPS/runtime receipt; reviewed package has the same dataRevision',
      },
      sourceReviewBasis: {
        sourceRevision: W13_SOURCE_REVISION,
        technicalSha256: sha256(technicalBytes),
        sourceRecordCount: technical.records.length,
        currentSourceRecordCount: currentRecords.length,
        historicalSourceRecordCount: nonCurrentRecords.length,
        approvedTargetCount: technical.reviewReceipts.length,
        currentApprovedTargetCount: currentReceipts.length,
        historicalApprovedTargetCount: otherReceipts.length,
        sourceRefCount: technical.sourceRefs.length,
        sourceSnapshotCount: technical.sourceSnapshots.length,
      },
      reviewCandidate: {
        repository: 'Web', commit: WEB_W13_COMMIT, path: W13_CANDIDATE_PATH,
        gitBlobOid: W13_CANDIDATE_BLOB, byteLength: candidateBytes.length, sha256: sha256(candidateBytes),
        releaseId: candidate.releaseId, requestId: candidate.source.requestId,
        sourceReleaseId: candidate.source.releaseId, sourceRevision: candidate.source.sourceRevision,
        sourceArchiveSha256: candidate.source.archiveSha256, sourceManifestSha256: candidate.source.manifestSha256,
        inputDigest: candidate.inputDigest, contentVersion: candidate.contentVersion,
        dataRevision: candidate.manifest.dataRevision,
        receiptCount: candidate.review.receiptCount, approvedTargetCount: candidate.review.states.approved,
        totalTargets: candidate.review.targetCount, sourceTargets: candidate.review.sourceTargetCount,
        webTargets: candidate.review.webTargetCount,
        publicationEligible: candidate.publicationEligible,
        selectedOrPublishedByThisMatrix: false,
      },
      sharedPackage: {
        ...sharedPackage,
        recordIdentities: currentIdentityInventory,
      },
      sharedDomains: domainFiles.map(domain => ({
        ...domain,
        displayOwners: summarizeWebOwners(domains[domain.name]),
        currentRecordCopyCount: domains[domain.name].source.records.filter(record => record.gameReleaseId === W13_GAME_RELEASE_ID).length,
      })),
      w03CurrentRows: {
        total: currentSourceReport.rowCount + currentWebReport.rowCount,
        source: currentSourceReport.rowCount,
        web: currentWebReport.rowCount,
        unresolved: currentSourceReport.summary.unresolvedCount + currentWebReport.summary.currentGapCount,
        deferredW15: currentWebReport.summary.deferredW15Count,
        sourceReport: { path: 'docs/contracts/w14/source-current-row-reconciliation.json', sha256: sha256(currentSourceReportBytes) },
        webReport: { path: 'docs/contracts/w14/web-current-row-reconciliation.json', sha256: sha256(currentWebReportBytes) },
      },
      w03WeaponRegistry: {
        path: 'docs/contracts/w14/weapon-registry-current-reconciliation.json',
        sha256: sha256(registryReportBytes),
        totalEntries: sourceRefEvidence.summary.registryEntries,
        groupEntries: sourceRefEvidence.summary.groupEntries,
        memberEntries: sourceRefEvidence.summary.memberEntries,
        exactCurrentApprovedMembers: sourceRefEvidence.summary.approvedCurrentRecordMatches,
        unmatchedMembers: sourceRefEvidence.summary.unmatchedMembers,
        playerAvailabilityInferred: false,
        entries: sourceRefEvidence.rows.map(row => ({
          entryId: row.entryId, registryKind: row.registryKind, registryKey: row.registryKey,
          selector: row.selector, gameReleaseId: row.gameReleaseId,
          classification: row.classification, currentRecordIds: row.currentRecordIds,
          approvedFieldEvidenceCount: row.approvedFieldEvidence?.length ?? 0,
        })),
      },
      currentGapInterpretation: {
        w03FrozenCurrentCandidateGaps: currentSourceReport.summary.unresolvedCount + currentWebReport.summary.currentGapCount,
        registryOnlyUnmatchedMembers: sourceRefEvidence.summary.unmatchedMembers,
        registryOnlyMembersAreNotAutomaticallyCurrentRequired: true,
        registryOnlyMembersAreNotPlayerAvailabilityEvidence: true,
      },
    },
    extensionArchives: [sourceArchive26, sourceArchive9].map((archive, index) => ({
      label: index === 0 ? 'fixed 26-file W03 Extension input archive' : 'fixed nine-file additional W03 Extension input archive',
      manifest: archive.manifest,
      fileCount: archive.rows.length,
      rawBytes: archive.manifest.rawBytes,
      compressedBytes: archive.manifest.compressedBytes,
      w03Rows: archive.rows.reduce((count, row) => count + row.w03RowCount, 0),
      currentApproval: 'not-current-approved',
      files: archive.rows.map(row => ({
        ...row,
        versionEvidence: row.versionEvidence,
      })).sort((a, b) => compare(a.sourcePath, b.sourcePath)),
    })),
    extensionDomains: {
      playerGuides: guideInventory,
      hardcodedContentCandidates: hardcoded,
      otherLegacyInputs: archiveRows.filter(row => row.sourcePath !== 'data/v1/mechanics/player-guides.json')
        .map(row => ({ sourcePath: row.sourcePath, sourceCommit: row.sourceCommit, sourceGitBlobOid: row.sourceGitBlobOid,
          sourceSha256: row.sourceSha256, sourceByteLength: row.sourceByteLength, w03RowCount: row.w03RowCount,
          versionEvidence: row.versionEvidence, currentApproval: 'not-current-approved' }))
        .sort((a, b) => compare(a.sourcePath, b.sourcePath)),
      preservedProtectedOverlayBoundary: {
        archiveMode: 'fixed Git objects only; no dirty working-tree bodies used as migration input',
        freshProtectedWorkingTreeReadback: 'not performed; no fresh verification receipt exists',
      },
    },
    history: {
      route: '/history/1.13.1/',
      gameVersion: webHistoryIndex.gameVersion,
      source: webHistoryManifest.source,
      projection: {
        path: 'content/history/1.13.1/player-index.json',
        byteLength: webHistoryIndexBytes.length,
        sha256: sha256(webHistoryIndexBytes),
        counts: historyProjection.projectedCounts,
        excludedCounts: historyProjection.excludedCounts,
        excludedReasons: historyProjection.excludedReasons,
        entryCount: historyProjection.projectedEntryCount,
      },
      sourceCounts: historyProjection.sourceCounts,
      scope: 'player-readable summary only; full technical data remains in Source legacy archive; never current fallback',
    },
    ledgers: {
      a: {
        sha256: w03.walk.sourceLedgerSha256, entryCount: w03.walk.entryCount,
        shardCount: w03.walk.shardCount, groupCount: w03.walk.groupCount,
        groups: w03.groups, byOwnerAndScope: w03.byOwnerScope,
      },
      mods: modsMatrix,
    },
    generatedOutputs: {
      overlayStatus: 'not-generated-in-this-matrix-build',
      matrixIsNotAnOutcomeOverlay: true,
      rowReconciliationReports: [
        { path: 'docs/contracts/w14/source-current-row-reconciliation.json', sha256: sha256(currentSourceReportBytes), rows: currentSourceReport.rowCount },
        { path: 'docs/contracts/w14/web-current-row-reconciliation.json', sha256: sha256(currentWebReportBytes), rows: currentWebReport.rowCount },
        { path: 'docs/contracts/w14/weapon-registry-current-reconciliation.json', sha256: sha256(registryReportBytes), rows: registryReport.summary.registryEntries },
      ],
      privateSummary: {
        path: 'docs/contracts/w14/private-preservation-public-summary.json',
        sha256: sha256(privateSummaryBytes),
        containsPrivateLocator: false,
        containsPrivateRawBody: false,
      },
    },
    limits: [
      'This fixed current candidate scope does not equal the full in-game weapon catalog.',
      'The 200 unmatched registry members are unresolved source-identity coverage, not proof of absence, requirement, or player availability.',
      'The 631 player guides remain bound to historical 1.13.1 source dependencies; no approval is carried to 1.13.2.',
      'Some preserved Extension inputs have no explicit release declaration; no version is inferred from file name or textual similarity.',
      'The five protected local review bodies were not used as W14 migration inputs; no fresh body-hash verification receipt exists.',
    ],
  };

  const output = path.resolve(outputPath);
  const allowedRoot = path.resolve(webRoot, 'docs/contracts/w14');
  const relativeOutput = path.relative(allowedRoot, output);
  if (relativeOutput === '' || relativeOutput.startsWith(`..${path.sep}`) || path.isAbsolute(relativeOutput)
    || path.basename(output) !== 'domain-matrix.json') {
    throw new Error('matrix output must be exactly docs/contracts/w14/domain-matrix.json');
  }
  const jsonBytes = Buffer.from(`${JSON.stringify(matrix, null, 2)}\n`, 'utf8');
  const markdownBytes = Buffer.from(markdownForMatrix(matrix), 'utf8');
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, jsonBytes);
  await writeFile(path.join(path.dirname(output), 'domain-matrix.md'), markdownBytes);
  return { matrix, jsonBytes, markdownBytes, jsonSha256: sha256(jsonBytes), markdownSha256: sha256(markdownBytes) };
}

async function main() {
  const cli = parseCli(process.argv.slice(2));
  if (!cli['source-root'] || !cli['technical-json'] || !cli['private-summary']) {
    process.stdout.write('Usage: node scripts/content/build-w14-domain-matrix.mjs --source-root <pinned Source clone> --technical-json <verified public technical.json> --private-summary docs/contracts/w14/private-preservation-public-summary.json [--output docs/contracts/w14/domain-matrix.json]\n');
    process.exitCode = 2;
    return;
  }
  const scriptRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const output = path.resolve(cli.output ?? path.join(scriptRoot, 'docs/contracts/w14/domain-matrix.json'));
  const result = await buildW14DomainMatrix({
    webRoot: scriptRoot,
    sourceRoot: path.resolve(cli['source-root']),
    technicalJsonPath: path.resolve(cli['technical-json']),
    privateSummaryPath: path.resolve(cli['private-summary']),
    outputPath: output,
  });
  process.stdout.write(`W14 domain matrix verified: ${result.matrix.current.sharedPackage.uniqueRecordCount} unique Source records; ${result.matrix.current.w03CurrentRows.total} current W03 rows; ${result.matrix.extensionDomains.playerGuides.recordCount} historical guides; ${result.matrix.ledgers.a.entryCount} A rows; ${result.matrix.ledgers.mods.entryCount} Mods rows.\n`);
  process.stdout.write(`JSON SHA-256 ${result.jsonSha256}; Markdown SHA-256 ${result.markdownSha256}.\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
}
