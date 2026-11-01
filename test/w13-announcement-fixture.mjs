import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadWebAuthoringInputs, validateWebAuthoring } from '../scripts/content/contract-authoring.mjs';
import { computeDataRevision } from '../scripts/content/contract-release.mjs';
import { compileW08Candidate } from '../scripts/content/contract-w08-build.mjs';
import { validateSharedStaticFiles } from '../src/static/shared-release.mjs';

const REPOSITORY = 'https://github.com/SyuanTsai/DarkTide-Source-Data';
const RELEASE_ID = 'fixture-r2';
const COMPILER_FILES = [
  'content/schema/v2/shared-candidate.schema.json',
  'scripts/content/contract-authoring.mjs',
  'scripts/content/contract-release.mjs',
  'scripts/content/contract-w08-build.mjs',
  'scripts/content/retained-name-evidence.mjs',
  'scripts/content/contract-w14-history.mjs',
  'src/published/contract.mjs',
].map((filePath, index) => ({ path: filePath, sizeBytes: index + 1, sha256: String(index + 2).repeat(64) }));
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

function collectRecordRefs(value, refs = []) {
  if (Array.isArray(value)) {
    for (const item of value) collectRecordRefs(item, refs);
  } else if (value && typeof value === 'object') {
    if (typeof value.recordId === 'string' && typeof value.gameReleaseId === 'string') refs.push(value);
    for (const child of Object.values(value)) collectRecordRefs(child, refs);
  }
  return refs;
}

function sourceRecordKey(record) { return record.gameReleaseId + '\u0000' + record.recordId; }

function makeMode(name, sourceContract) {
  return {
    mode: name,
    authoring: {
      schemaVersion: '2.0.0',
      contractKind: 'web-authoring',
      fixtureOnly: false,
      publicationEligible: false,
      sourcePin: {},
      officialInputsSha256: 'a'.repeat(64),
      presentations: [],
      termLocalizations: [],
      announcements: [],
      gameChanges: [],
      officialTextChanges: [],
      reviewTargets: [],
      reviewReceipts: [],
    },
    officialInputs: { sources: [] },
    termRules: { rules: [] },
    reviewStates: {},
    webLock: {},
    sourceContract: structuredClone(sourceContract),
  };
}

function makeAnnouncementInput(donor, announcement) {
  const sourceContract = structuredClone(donor.sourceContract);
  sourceContract.fixtureOnly = false;
  sourceContract.publicationEligible = false;
  const release = sourceContract.gameReleases.find(item => item.gameReleaseId === RELEASE_ID);
  if (!release) throw new Error('W13 fixture donor has no fixture-r2 release');

  const authoring = structuredClone(donor.authoring);
  const previousAnnouncementIds = new Set(authoring.announcements.map(item => item.announcementId));
  authoring.presentations = authoring.presentations.filter(item => item.entityRef.gameReleaseId === RELEASE_ID
    && ['skill', 'blessing', 'weapon'].includes(item.entityRef.kind));
  authoring.termLocalizations = authoring.termLocalizations.filter(item => item.termRef.gameReleaseId === RELEASE_ID);
  authoring.announcements = [announcement];
  authoring.gameChanges = [];
  authoring.officialTextChanges = [];
  for (const target of authoring.reviewTargets) {
    if (target.ownerKind === 'announcement' && previousAnnouncementIds.has(target.ownerId)) {
      target.ownerId = announcement.announcementId;
      target.targetId = 'fixture:review:w13-announcement:blocks';
    }
  }
  const ownerIds = new Set([
    ...authoring.presentations.map(item => item.authoringId),
    ...authoring.termLocalizations.map(item => item.authoringId),
    ...authoring.announcements.map(item => item.announcementId),
  ]);
  authoring.reviewTargets = authoring.reviewTargets.filter(target => ownerIds.has(target.ownerId));
  const targetIds = new Set(authoring.reviewTargets.map(target => target.targetId));
  authoring.reviewReceipts = authoring.reviewReceipts.filter(receipt => targetIds.has(receipt.targetId));

  const sourceRecordMap = new Map(sourceContract.records.map(record => [sourceRecordKey(record), record]));
  const seeds = sourceContract.records.filter(record =>
    (record.gameReleaseId === RELEASE_ID && ['skill', 'blessing', 'weapon', 'term', 'armor-class'].includes(record.kind))
    || (record.kind === 'release-compatibility'
      && (record.gameReleaseId === RELEASE_ID || record.payload?.toGameReleaseId === RELEASE_ID)));
  const queue = [
    ...seeds,
    ...collectRecordRefs([authoring.presentations, authoring.termLocalizations, authoring.announcements]).map(ref => {
      const record = sourceRecordMap.get(sourceRecordKey(ref));
      if (!record || (ref.kind && record.kind !== ref.kind)) throw new Error('W13 fixture has an unresolved Web Source ref');
      return record;
    }),
  ];
  const selected = new Map();
  while (queue.length) {
    const record = queue.pop();
    const key = sourceRecordKey(record);
    if (selected.has(key)) continue;
    selected.set(key, record);
    for (const ref of collectRecordRefs(record.payload)) {
      const target = sourceRecordMap.get(sourceRecordKey(ref));
      if (!target || (ref.kind && target.kind !== ref.kind)) throw new Error('W13 fixture has an unresolved Source ref');
      queue.push(target);
    }
  }
  sourceContract.records = [...selected.values()];
  sourceContract.tombstones = [];
  const selectedKeys = new Set(selected.keys());
  sourceContract.reviewReceipts = sourceContract.reviewReceipts.filter(receipt =>
    selectedKeys.has(receipt.target?.gameReleaseId + '\u0000' + receipt.target?.recordId));

  const validation = validateWebAuthoring(authoring, { ...donor, authoring });
  if (!validation.valid) throw new Error('W13 announcement fixture is invalid: '
    + validation.issues.map(issue => issue.path + ' ' + issue.message).join('; '));

  const w06 = makeMode('w06', sourceContract);
  w06.officialInputs = { sources: [] };
  w06.termRules = donor.termRules;
  const w07 = makeMode('w07', sourceContract);
  w07.authoring = authoring;
  w07.officialInputs = structuredClone(donor.officialInputs);
  w07.termRules = donor.termRules;
  w07.reviewStates = Object.fromEntries(authoring.reviewTargets.map(target => [target.targetId, 'pending']));

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

function makeFixtureAnnouncement(donor) {
  const announcement = structuredClone(donor.authoring.announcements.find(item => item.scope === 'site'));
  if (!announcement) throw new Error('W13 fixture donor has no site announcement');
  announcement.announcementId = 'fixture:announcement:w13-site';
  announcement.publishedOn = '2026-10-24';
  announcement.revision = 1;
  announcement.source = {
    kind: 'site-owner',
    locator: 'W13 G02 公告呈現測試資料；不是正式公告',
    sha256: sha256(Buffer.from('W13 G02 公告呈現測試資料；不是正式公告', 'utf8')),
  };
  announcement.blocks.find(block => block.kind === 'heading').text = 'W13 公告展示測試（不可發布）';
  announcement.blocks.find(block => block.kind === 'paragraph').text = '此合成資料只驗證公告呈現，不代表正式內容。';
  const images = announcement.blocks.filter(block => block.kind === 'image');
  images[0].alt = '測試分隔圖第一次出現';
  images[1].alt = '測試分隔圖第二次出現';
  const spoiler = announcement.blocks.find(block => block.kind === 'spoiler');
  spoiler.label = '不可發布測試內容';
  spoiler.blocks.push({
    blockId: 'fixture:block:w13-video-link',
    kind: 'link',
    text: '測試影片連結（以連結保留，不嵌入）',
    href: 'https://example.invalid/w13-announcement-video',
  });
  const assetId = 'fixture:asset:w13-divider';
  for (const image of images) image.assetRef = { assetId };
  announcement.assets = [{
    assetId,
    mediaType: 'image/png',
    alt: '帶有顱骨裝飾的橫向分隔線',
    sourceUri: 'https://github.com/user-attachments/assets/dfaa4318-92c8-4f5e-909a-5b5cc6fd100e',
    sha256: 'dab4eccbcf29a66a4da56bbdc344aa8258511b91e3f4ccf7b821d09bc9e89ac9',
    sizeBytes: 6418,
  }];
  return announcement;
}

function makeSharedStaticFixture(compiled) {
  const manifest = compiled.manifest;
  const revision = manifest.dataRevision;
  const manifestBytes = Buffer.from(JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  const pointer = {
    game_version: manifest.gameVersion,
    content_version: manifest.contentVersion,
    data_revision: revision,
    manifest_path: '/data/' + revision + '/manifest.json',
    manifest_sha256: sha256(manifestBytes),
  };
  const version = {
    schema_version: 2,
    data_revision: revision,
    build_id: 'c'.repeat(64),
    game_version: manifest.gameVersion,
    package_kind: 'fixture',
    game_releases: [pointer],
  };
  const files = new Map([['data/' + revision + '/manifest.json', manifestBytes]]);
  for (const [relativePath, bytes] of compiled.files) files.set('data/' + revision + '/' + relativePath, bytes);
  const sourceLock = {
    schema: 'w09-public-source-lock/1',
    repository: manifest.source.repository,
    source_revision: manifest.source.sourceRevision,
    source_manifest_sha256: manifest.source.manifestSha256,
    game_release_id: manifest.gameReleaseId,
    game_version: manifest.gameVersion,
    content_version: manifest.contentVersion,
  };
  const sourceLockBytes = Buffer.from(JSON.stringify(sourceLock, null, 2) + '\n', 'utf8');
  files.set('source-locks/' + manifest.source.sourceRevision + '/' + sha256(sourceLockBytes) + '.json', sourceLockBytes);
  const bundle = validateSharedStaticFiles({
    version,
    fixtureMarker: { fixtureOnly: true, publicationEligible: false, fixtureId: 'synthetic-w13-announcement-renderer' },
    files,
  });
  const build = {
    game_version: version.game_version,
    data_revision: version.data_revision,
    build_id: version.build_id,
    ...bundle.metadata,
  };
  const responses = new Map([...files].map(([filePath, bytes]) => ['/' + filePath, bytes]));
  return { version, bundle, build, responses };
}

export async function makeCompiledAnnouncementFixture({ announcementDependencies, announcement: suppliedAnnouncement } = {}) {
  const donor = await loadWebAuthoringInputs({ repoRoot: REPO_ROOT });
  const announcement = suppliedAnnouncement ? structuredClone(suppliedAnnouncement) : makeFixtureAnnouncement(donor);
  const compiled = compileW08Candidate(makeAnnouncementInput(donor, announcement));
  const announcementFile = compiled.manifest.files.find(file => file.kind === 'announcements');
  if (!announcementFile) throw new Error('W08 compiler omitted its announcement domain');
  if (announcementDependencies !== undefined) {
    announcementFile.dependencies = [...announcementDependencies];
    compiled.manifest.dataRevision = computeDataRevision(compiled.manifest);
  }
  const announcementDomain = JSON.parse(compiled.files.get(announcementFile.path).toString('utf8'));
  const shared = makeSharedStaticFixture(compiled);
  return {
    announcement,
    announcementDomain,
    compiled,
    ...shared,
  };
}
