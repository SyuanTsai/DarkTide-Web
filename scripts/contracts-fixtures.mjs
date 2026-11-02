import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixtureRoot = path.join(repoRoot, 'test', 'fixtures', 'contracts');

async function copyRelative(sourceRoot, targetRoot, relative) {
  const source = path.join(sourceRoot, ...relative.split('/'));
  const target = path.join(targetRoot, ...relative.split('/'));
  await mkdir(path.dirname(target), { recursive: true });
  await copyFile(source, target);
}

async function writeJson(root, relative, value) {
  const destination = path.join(root, ...relative.split('/'));
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, `${JSON.stringify(value, null, 2)}\n`);
}

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

async function readJson(root, relative) {
  return JSON.parse(await readFile(path.join(root, ...relative.split('/')), 'utf8'));
}

async function createModsFixture() {
  const sourceRoot = path.join(repoRoot, 'docs', 'contracts', 'w03');
  const targetRoot = path.join(fixtureRoot, 'w14', 'w03');
  const index = await readJson(sourceRoot, 'mods/mapping-ledger.json');
  const wanted = new Set(['M01', 'M05', 'M07', 'K01', 'M08']);
  for (const group of index.groups) {
    if (!wanted.has(group.groupId)) continue;
    for (const descriptor of group.shards) {
      if (group.groupId === 'M01' && descriptor !== group.shards[0]) continue;
      await copyRelative(sourceRoot, targetRoot, descriptor.path);
    }
  }
  await copyRelative(sourceRoot, targetRoot, 'mods/mapping-ledger.json');
}

async function createW14ReportsFixture() {
  const sourceRoot = path.join(repoRoot, 'docs', 'contracts', 'w14');
  const targetRoot = path.join(fixtureRoot, 'w14');
  const registry = await readJson(sourceRoot, 'weapon-registry-current-reconciliation.json');
  await writeJson(targetRoot, 'weapon-registry-current-reconciliation.json', {
    inputBindings: {
      w03Ledger: { sha256: registry.inputBindings.w03Ledger.sha256 },
      registryShard: { containerSha256: registry.inputBindings.registryShard.containerSha256 },
      sourceCode: {
        commit: registry.inputBindings.sourceCode.commit,
        verifiedEntryFragments: registry.inputBindings.sourceCode.verifiedEntryFragments,
      },
      currentSourcePackageReviewBasis: {
        approvedCurrentSourceTargetCount: registry.inputBindings.currentSourcePackageReviewBasis.approvedCurrentSourceTargetCount,
        contentVersion: registry.inputBindings.currentSourcePackageReviewBasis.contentVersion,
      },
      activePublishedData: {
        contentVersion: registry.inputBindings.activePublishedData.contentVersion,
        sameDataRevisionAsReviewBasis: registry.inputBindings.activePublishedData.sameDataRevisionAsReviewBasis,
      },
    },
    summary: { playerAvailabilityInferred: registry.summary.playerAvailabilityInferred },
    interpretation: { playerAvailabilityInferred: registry.interpretation.playerAvailabilityInferred },
    rows: registry.rows.map(row => ({
      entryId: row.entryId,
      registryKind: row.registryKind,
      registryKey: row.registryKey,
      selector: { locator: row.selector.locator },
      sourceFragmentSha256: row.sourceFragmentSha256,
      sourceByteRange: row.sourceByteRange,
      classification: row.classification,
      gameReleaseId: row.gameReleaseId,
      associatedCurrentRecordIds: row.associatedCurrentRecordIds,
      currentRecordIds: row.currentRecordIds,
      currentRecordEvidence: row.currentRecordEvidence?.map(evidence => ({ approvedFields: evidence.approvedFields })),
    })),
  });

  const source = await readJson(sourceRoot, 'source-current-row-reconciliation.json');
  const sourceRows = source.rows
    .filter(row => row.decision?.target?.sourceFieldResolution?.relation === 'legacy-child-absent-current-approved-parent-container')
    .map(row => ({ decision: { target: { fieldPath: row.decision.target.fieldPath, actualValueCanonicalSha256: row.decision.target.actualValueCanonicalSha256,
      sourceFieldResolution: row.decision.target.sourceFieldResolution } } }));
  await writeJson(targetRoot, 'source-current-row-reconciliation.json', { rows: sourceRows });

  const web = await readJson(sourceRoot, 'web-current-row-reconciliation.json');
  const wantedEntries = new Set(['w03-363b5ef660cc42a3a8e72612', 'w03-6ef7ce5434aedeb86c6e42bb']);
  await writeJson(targetRoot, 'web-current-row-reconciliation.json', {
    rows: web.rows.filter(row => wantedEntries.has(row.entryId)),
  });
}

export async function generateContractFixtures() {
  await rm(fixtureRoot, { recursive: true, force: true });
  const sourceW03 = path.join(repoRoot, 'docs', 'contracts', 'w03');
  const targetW03 = path.join(fixtureRoot, 'w14', 'w03');
  const ledger = JSON.parse(await readFile(path.join(sourceW03, 'mapping-ledger.json'), 'utf8'));
  const selectedDescriptors = ledger.shards.filter(descriptor => descriptor.groupId === 'source-code-registry' || descriptor.groupId === 'web-w01-inputs');
  await writeJson(targetW03, 'mapping-ledger.json', { ...ledger, shards: selectedDescriptors });
  for (const descriptor of selectedDescriptors) await copyRelative(sourceW03, targetW03, descriptor.path);
  await createModsFixture();

  await createW14ReportsFixture();

  await copyCandidate('c41434cc510b4d28b91e59a14ac681e5aa973a09958ba3b7eb03d10eb13a8a00', 'w09-c414');
  await copyCandidate('d8d430c3f105696a06d4f2af040e095d260546fbae38960d8ec1cb0eb1f56bab', 'w09-d8d');
  await copyTreeFiles(path.join(repoRoot, 'content', 'contracts', 'w13', 'ranged-candidate'), path.join(fixtureRoot, 'w13', 'ranged-candidate'));
}

async function copyCandidate(proposalId, fixtureName) {
  await copyTreeFiles(
    path.join(repoRoot, 'content', 'contracts', 'w09', 'proposals', proposalId, 'candidate'),
    path.join(fixtureRoot, fixtureName, 'candidate'),
  );
}

async function copyTreeFiles(source, target) {
  const entries = await (await import('node:fs/promises')).readdir(source, { withFileTypes: true });
  for (const entry of entries) {
    const sourcePath = path.join(source, entry.name);
    const targetPath = path.join(target, entry.name);
    if (entry.isDirectory()) await copyTreeFiles(sourcePath, targetPath);
    else if (entry.isFile()) {
      await mkdir(path.dirname(targetPath), { recursive: true });
      await copyFile(sourcePath, targetPath);
    }
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  generateContractFixtures().catch(error => {
    process.stderr.write(`${error.stack ?? error.message}\n`);
    process.exitCode = 1;
  });
}
