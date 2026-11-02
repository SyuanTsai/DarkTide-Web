import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  replayW09ProposalFromManifest,
  verifyW09ProposalManifestDirectory,
  writeW09ProposalManifest,
} from '../scripts/w09-proposal-manifest.mjs';

const SOURCE_REVISION = 'a'.repeat(64);
const GAME_RELEASE_ID = 'darktide:fixture-release';
const RELEASE_ID = 'w09-' + createHash('sha256')
  .update(JSON.stringify({ gameReleaseId: GAME_RELEASE_ID, sourceRevision: SOURCE_REVISION }))
  .digest('hex')
  .slice(0, 32);
const PROPOSAL_ID = 'c'.repeat(64);
const PACKET_PATHS = [
  'analysis.md',
  'source-revision.json',
  'source-revision.md',
  'source-manifest.json',
  'source-receipt.json',
  'technical.json',
];

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function fixtureProposal(releaseId = RELEASE_ID) {
  return {
    schema: 'w09-source-composition-proposal/1',
    proposalOnly: true,
    selected: false,
    allocationReserved: false,
    publicationEligible: false,
    requestId: '1'.repeat(64),
    releaseId,
    gameReleaseId: GAME_RELEASE_ID,
    sourceCommit: '2'.repeat(40),
    sourceRevision: SOURCE_REVISION,
    manifestSha256: '3'.repeat(64),
    archiveSha256: '4'.repeat(64),
    packetFiles: PACKET_PATHS.map((packetPath, index) => ({
      path: packetPath,
      sha256: '56789a'[index].repeat(64),
      sizeBytes: index + 1,
    })),
  };
}

async function writeFixtureProposal(proposalDirectory, { tampered = false } = {}) {
  await mkdir(path.join(proposalDirectory, 'candidate/domains'), { recursive: true });
  const proposal = fixtureProposal();
  const files = new Map([
    ['proposal.json', JSON.stringify(proposal) + '\n'],
    ['source-lock.json', '{"source":true}\n'],
    ['web-input-lock.json', '{"web":true}\n'],
    ['review-candidate.json', '{"review":true}\n'],
    ['candidate/manifest.json', '{"candidate":true}\n'],
    ['candidate/domains/weapons.json', tampered ? '{"weapons":["tampered"]}\n' : '{"weapons":[]}\n'],
  ]);
  for (const [relativePath, bytes] of files) {
    await writeFile(path.join(proposalDirectory, ...relativePath.split('/')), bytes, 'utf8');
  }
  return proposal;
}

async function fixtureRoot(t) {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), 'w09-proposal-manifest-'));
  const proposalDirectory = path.join(repoRoot, 'content/contracts/w09/proposals', PROPOSAL_ID);
  t.after(() => rm(repoRoot, { recursive: true, force: true }));
  return { repoRoot, proposalDirectory };
}

// Scenario: A replayed compose proposal contains the fixed metadata files and nested candidate payload.
// Purpose: Keep the candidate PR artifact small while pinning every reconstructible byte and Source locator.
test('UnitT10_write-manifest-pins-every-generated-file-size-and-sha256', async t => {
  const { proposalDirectory } = await fixtureRoot(t);
  const proposal = await writeFixtureProposal(proposalDirectory);

  const result = await writeW09ProposalManifest({
    proposalDirectory,
    expectedReleaseId: RELEASE_ID,
    expectedSourceRevision: SOURCE_REVISION,
  });

  assert.equal(result.manifest.schema, 'w09-proposal-manifest/1');
  assert.deepEqual(result.manifest.source, {
    repository: 'SyuanTsai/DarkTide-Source-Data',
    releaseId: RELEASE_ID,
    archiveSha256: proposal.archiveSha256,
  });
  assert.deepEqual(result.manifest.files.map(row => row.path), [
    'candidate/domains/weapons.json',
    'candidate/manifest.json',
    'proposal.json',
    'review-candidate.json',
    'source-lock.json',
    'web-input-lock.json',
  ]);
  for (const row of result.manifest.files) {
    const bytes = await readFile(path.join(proposalDirectory, ...row.path.split('/')));
    assert.equal(row.sizeBytes, bytes.byteLength);
    assert.equal(row.sha256, sha256(bytes));
  }
  assert.ok(result.manifestBytes.byteLength < 200 * 1024);
  assert.ok(result.manifestBytes.toString('utf8').startsWith('{"files":'),
    'manifest bytes must retain the canonical key order used by existing candidate branches');
  await verifyW09ProposalManifestDirectory({
    proposalDirectory,
    expectedReleaseId: RELEASE_ID,
    expectedSourceRevision: SOURCE_REVISION,
  });
});

// Scenario: A reviewed manifest is edited to point one row outside its proposal directory.
// Purpose: Prevent candidate metadata from turning reconstruction checks into arbitrary filesystem reads.
test('UnitT15_verify-manifest-rejects-unsafe-relative-paths', async t => {
  const { proposalDirectory } = await fixtureRoot(t);
  await writeFixtureProposal(proposalDirectory);
  const { manifest } = await writeW09ProposalManifest({
    proposalDirectory,
    expectedReleaseId: RELEASE_ID,
    expectedSourceRevision: SOURCE_REVISION,
  });
  manifest.files[0].path = '../outside.json';
  await writeFile(path.join(proposalDirectory, 'manifest.json'), JSON.stringify(manifest) + '\n', 'utf8');

  await assert.rejects(
    verifyW09ProposalManifestDirectory({ proposalDirectory }),
    /safe|escape|path/u,
  );
});

// Scenario: A candidate checkout contains only its prior manifest and compose replays the same Source release.
// Purpose: Prove a retry can reconstruct and verify the full proposal without storing the payload in Git.
test('UnitT20_replay-restores-manifest-only-proposal-and-verifies-identical-bytes', async t => {
  const { repoRoot, proposalDirectory } = await fixtureRoot(t);
  await writeFixtureProposal(proposalDirectory);
  const initial = await writeW09ProposalManifest({
    proposalDirectory,
    expectedReleaseId: RELEASE_ID,
    expectedSourceRevision: SOURCE_REVISION,
  });
  for (const relativePath of initial.generatedPaths) {
    await rm(path.join(proposalDirectory, ...relativePath.split('/')), { force: true });
  }

  const replayed = await replayW09ProposalFromManifest({
    repoRoot,
    releaseId: RELEASE_ID,
    replay: async () => {
      await assert.rejects(readFile(path.join(proposalDirectory, 'manifest.json')), { code: 'ENOENT' });
      await writeFixtureProposal(proposalDirectory);
      return { proposalWritten: true, sourceRevision: SOURCE_REVISION, proposalDirectory };
    },
  });

  assert.equal(replayed.proposalWritten, true);
  assert.deepEqual(await readFile(path.join(proposalDirectory, 'manifest.json')), initial.manifestBytes);
  await verifyW09ProposalManifestDirectory({
    proposalDirectory,
    expectedReleaseId: RELEASE_ID,
    expectedSourceRevision: SOURCE_REVISION,
  });
});

// Scenario: Compose replays a manifest-only proposal but one reconstructed payload file has different bytes.
// Purpose: Fail closed on Source or compiler drift and restore the reviewable manifest after rejection.
test('UnitT30_replay-rejects-sha256-mismatch-and-restores-original-manifest', async t => {
  const { repoRoot, proposalDirectory } = await fixtureRoot(t);
  await writeFixtureProposal(proposalDirectory);
  const initial = await writeW09ProposalManifest({
    proposalDirectory,
    expectedReleaseId: RELEASE_ID,
    expectedSourceRevision: SOURCE_REVISION,
  });
  for (const relativePath of initial.generatedPaths) {
    await rm(path.join(proposalDirectory, ...relativePath.split('/')), { force: true });
  }

  await assert.rejects(
    replayW09ProposalFromManifest({
      repoRoot,
      releaseId: RELEASE_ID,
      replay: async () => {
        await writeFixtureProposal(proposalDirectory, { tampered: true });
        return { proposalWritten: true, sourceRevision: SOURCE_REVISION, proposalDirectory };
      },
    }),
    /manifest|SHA-256|reconstruction/u,
  );

  assert.deepEqual(await readFile(path.join(proposalDirectory, 'manifest.json')), initial.manifestBytes);
  await assert.rejects(readFile(path.join(proposalDirectory, 'proposal.json')), { code: 'ENOENT' });
});
