import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const nodeExe = process.execPath;

// Scenario: the fixed Web W03 current-snapshot rows are reconciled against the public W13 owner candidate and its exact review overlays.
// Purpose: protect a reproducible 568-row crosswalk with source fragments, owner mappings, and receipt closure instead of relying on the task-local diagnostic.
// Given the pinned W03 ledger and W13 owner inputs; when the repository CLI rebuilds the report; then every source row is represented and approved labels carry exact receipt evidence.
test('InterT10_rebuilds-pinned-Web-current-row-reconciliation-from-public-owner-inputs', async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'w14-web-row-map-'));
  const outputPath = path.join(tempRoot, 'web-current-row-reconciliation.json');
  try {
    execFileSync(nodeExe, ['scripts/content/build-w14-web-row-reconciliation.mjs', '--output', outputPath], {
      cwd: repoRoot,
      stdio: 'pipe',
      maxBuffer: 4 * 1024 * 1024,
    });
    const report = JSON.parse(await readFile(outputPath, 'utf8'));
    assert.equal(report.schemaVersion, 'w14.web-current-row-reconciliation.v1');
    assert.equal(report.status, 'review-candidate-not-approval');
    assert.equal(report.inputBindings.w03Ledger.sha256, 'bdf4b02c278e9dafef9aea00ac8263fe7929b29e9dc0eb90325cf7c55daa2288');
    assert.equal(report.inputBindings.w13OwnerCandidate.candidateOnly, true);
    assert.equal(report.inputBindings.w13OwnerCandidate.publicationEligible, false);
    assert.equal(report.rowCount, 568);
    assert.equal(report.rows.length, report.rowCount);
    assert.equal(new Set(report.rows.map(row => row.entryId)).size, report.rowCount);
    assert.ok(report.rows.some(row => row.disposition === 'deferred-w15'));
    assert.equal(report.summary.currentGapCount, 0);
    const normalizedSegmentKinds = report.rows.filter(row => row.currentMapping?.sourceNormalization?.rule === 'w03-segment-kind-to-w08-segment-kind');
    assert.equal(normalizedSegmentKinds.length, 23);
    assert.ok(normalizedSegmentKinds.every(row => row.disposition === 'approved-current-rewrite'
      && row.currentMapping.sourceValueMatchesCurrent === false
      && row.currentMapping.normalizedSourceValueMatchesCurrent === true
      && ['literal', 'template-placeholder'].includes(row.currentMapping.sourceNormalization.from)
      && ['text', 'parameter'].includes(row.currentMapping.sourceNormalization.to)));
    const sourceLockRows = report.rows.filter(row => row.source.path === 'source.lock.json' && row.selector.locator.startsWith('/artifacts/'));
    assert.equal(sourceLockRows.length, 2);
    const technicalArtifact = sourceLockRows.find(row => row.selector.locator === '/artifacts/0');
    assert.equal(technicalArtifact.currentMapping.kind, 'source-technical-packet-and-four-core-domains');
    assert.equal(technicalArtifact.currentMapping.sourceArtifactName, 'technical.json');
    assert.equal(technicalArtifact.currentMapping.coreDomains.length, 4);
    assert.match(technicalArtifact.currentMapping.sourcePacket.sha256, /^[a-f0-9]{64}$/u);
    const absentChangesArtifact = sourceLockRows.find(row => row.selector.locator === '/artifacts/1');
    assert.equal(absentChangesArtifact.currentMapping.kind, 'legacy-game-change-artifact-not-emitted-by-current-manifest');
    assert.equal(absentChangesArtifact.currentMapping.sourceArtifactName, 'game-changes.json');
    assert.equal(absentChangesArtifact.currentMapping.currentChangeIndex.path, null);
    assert.equal(absentChangesArtifact.currentMapping.currentChangeIndex.manifestSha256, report.inputBindings.w13OwnerCandidate.manifestSha256);

    const termKind = report.rows.find(row => row.source.path === 'content/w01/web-authoring.json' && row.selector.locator === '/records/4/kind');
    assert.equal(termKind.currentMapping.fieldPath, '/termRef/kind');
    const termRef = report.rows.find(row => row.source.path === 'content/w01/web-authoring.json' && row.selector.locator === '/records/4/entityRef');
    assert.equal(termRef.currentMapping.fieldPath, '/termRef');
    for (const row of report.rows) {
      if (row.disposition === 'approved-current-reuse' || row.disposition === 'approved-current-rewrite') {
        assert.ok(row.evidence.ownerCandidateTargets.length > 0, row.entryId);
        assert.ok(row.evidence.ownerCandidateTargets.every(target => target.candidateState === 'approved'
          && target.receiptMatchesPinnedOwnerCandidate === true
          && /^[a-f0-9]{64}$/u.test(target.targetDigest)
          && /^[a-f0-9]{64}$/u.test(target.dependenciesDigest)), row.entryId);
      }
    }
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});
