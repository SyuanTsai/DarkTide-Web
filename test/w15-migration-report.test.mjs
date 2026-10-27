import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  buildW15M07MigrationReport,
  buildW15M08MigrationReport,
  buildW15A17MigrationReport,
} from '../scripts/content/contract-w15-migration.mjs';
import { buildW15AnnouncementCandidate } from '../scripts/content/w15-announcement-import.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPORT_SCRIPT = path.join(REPO_ROOT, 'scripts/content/w15-migration-report.mjs');
import {
  buildW15M05MigrationReport,
  buildW15SourceTermCandidate,
  buildW15MigrationOverlay,
} from '../scripts/content/w15-migration-report.mjs';

// Scenario: Every fixed M07 tool row is tied to its existing owner and the actual replacement surface.
// Purpose: Prevent archived tooling from being mislabeled as a new game-data approval or routed to the wrong repository.
test('UnitT10_maps_fixed_M07_tools_to_their_owner_replacements', async () => {
  const report = await buildW15M07MigrationReport();
  assert.equal(report.rows.length, 8);
  assert.deepEqual(report.destinationOwners, [
    { repoId: 'source', rowCount: 2 },
    { repoId: 'web', rowCount: 1 },
    { repoId: 'private', rowCount: 5 },
  ]);
  assert.ok(report.rows.every(row => row.source.gitBlobOid && row.source.fragmentGitBlobOid
    && row.status && row.target.path && row.target.repoId));
  const privateTools = report.rows.filter(row => row.target.repoId === 'private');
  assert.equal(report.privateToolBundle.fixedCommit, '194e8b043f18f9f3c877ed6790118add47401a5e');
  assert.equal(report.privateToolBundle.files.length, 9);
  assert.equal(report.privateToolBundle.totalBytes, 69236);
  assert.equal(privateTools.length, 5);
  for (const path of ['tools/game-data/decode_strings.py', 'tools/game-data/compare_text_exports.py', 'tools/game-data/verify_exports.py']) {
    const row = privateTools.find(item => item.target.path === path);
    assert.equal(row.sourceComparison.method, 'crlf-lf-normalization');
    assert.equal(row.sourceComparison.normalizedContentEqual, true);
    assert.equal(row.destinationEvidence.fixedCommit, report.privateToolBundle.fixedCommit);
  }
  const limnReadme = privateTools.find(row => row.source.path.endsWith('/vendor/limn/README.md'));
  assert.equal(limnReadme.sourceComparison.method, 'byte-identical');
  assert.equal(limnReadme.sourceComparison.targetSha256, limnReadme.sourceComparison.sourceSha256);
  const validator = report.rows.find(row => row.source.path.endsWith('/validate_game_info.py'));
  assert.equal(validator.status, 'migrated-exact-local-markdown-reference-check');
  assert.equal(validator.target.path, validator.source.path);
  assert.equal(validator.destinationEvidence.gitBlobOid, validator.source.gitBlobOid);
  const validatorTests = report.rows.find(row => row.source.path.endsWith('test_validate_game_info.py'));
  assert.equal(validatorTests.status, 'migrated-existing-synthetic-local-reference-tests');
  assert.equal(validatorTests.target.path, validatorTests.source.path);
  const runbook = privateTools.find(row => row.source.path.endsWith('/README.md'));
  assert.equal(runbook.status, 'private-owner-runbook-extended-for-m07');
  assert.equal(runbook.destinationEvidence.currentWorktreeBytes, 9252);
  assert.equal(report.publicationEligible, false);
  assert.equal(report.rows.find(row => row.source.path.endsWith('render_skill_pages.mjs')).target.path, 'web/shared-render.mjs');
  assert.equal(report.rows.find(row => row.source.path.endsWith('/validate_game_info.py')).target.path, 'scripts/game-info/validate_game_info.py');
  assert.equal(report.rows.find(row => row.source.path.endsWith('test_validate_game_info.py')).target.path, 'scripts/game-info/tests/test_validate_game_info.py');
});

// Scenario: Fixed M08 terminology rows point to reviewable owner references while MOD-only rows stay at their original files.
// Purpose: Preserve every original selector and fragment without promoting candidate glossary text into released data.
test('UnitT20_maps_fixed_M08_rows_by_typed_owner_and_exact_source_fragment', async () => {
  const report = await buildW15M08MigrationReport();
  assert.equal(report.rows.length, 2623);
  assert.equal(new Set(report.rows.map(row => row.entryId)).size, 2623);
  assert.equal(report.candidateOnly, true);
  assert.equal(report.publicationEligible, false);
  assert.equal(report.decisions.gameContentApprovalCreated, false);
  assert.ok(report.rows.every(row => (row.source.fragmentSha256 || row.source.fragmentGitBlobOid) && row.source.gitBlobOid
    && row.target.repoId && row.target.path && row.status));
  assert.ok(report.rows.filter(row => row.target.repoId === 'mods').every(row => row.status === 'retained-at-fixed-source'));
  assert.ok(report.rows.filter(row => row.status === 'candidate-pending-review').every(row => row.reviewState === 'pending'));
  assert.ok(report.rows.filter(row => row.status === 'historical-reference-candidate').every(row => row.reviewState === 'not-applicable'));
  assert.equal(report.rows.filter(row => row.target.fieldPath === 'terms.unverifiedCandidate').length, 117);
  assert.ok(report.termReferences.every(row => row.source.fragmentSha256 && row.sourceText));
});

// Scenario: The five imported announcements and the old W01 announcement candidate share broad topic wording but not record identity or review evidence.
// Purpose: Keep all 1,291 M05 source selectors bound to exact pending candidate occurrences while preserving A17 as a separate pending legacy record.
test('UnitT30_keeps_M05_candidate_and_A17_legacy_record_separate', async () => {
  const [m05, a17, candidate] = await Promise.all([
    buildW15M05MigrationReport(), buildW15A17MigrationReport(), buildW15AnnouncementCandidate(),
  ]);
  assert.equal(m05.rows.length, 1291);
  assert.equal(m05.candidateOnly, true);
  assert.equal(m05.source.commit, '241ad76ce62330472aa423055a5b85db59bb6c0d');
  assert.ok(m05.rows.every(row => row.reviewState === 'pending' && row.target.announcementId));
  assert.equal(a17.rows.length, 17);
  assert.ok(a17.rows.every(row => row.status === 'retained-pending-w01-candidate'
    && row.reviewState === 'pending' && row.target.recordId === 'web:announcement:w01-real-candidate-003'));
  assert.ok(a17.rows.every(row => !candidate.announcements.some(announcement => announcement.announcementId === row.target.recordId)));
  assert.equal(a17.decisions.deduplicatedIntoM05, false);
});

// Scenario: Source-owned M08 references are exported separately from Web labels and pending gameplay authoring.
// Purpose: Preserve all 1,332 exact source selectors without implying release inclusion or approval.
test('UnitT40_exports_only_exact_pending_Source_owned_M08_reference_rows', async () => {
  const report = await buildW15M08MigrationReport();
  const candidate = buildW15SourceTermCandidate(report);
  assert.equal(candidate.terms.length, 1332);
  assert.equal(candidate.candidateOnly, true);
  assert.equal(candidate.publicationEligible, false);
  assert.equal(candidate.reviewState, 'pending');
  assert.equal(candidate.decisions.approvalReceiptCreated, false);
  assert.equal(candidate.terms.reduce((total, term) => total + term.sourceRows.length, 0), 1332);
  assert.ok(candidate.terms.every(term => term.sourceRows.length === 1
    && term.sourceRows[0].repoId === 'mods'
    && term.sourceRows[0].fragmentSha256
    && term.sourceRows[0].selector.locator
    && term.contexts.length > 0
    && term.contexts.every(context => context.owner === 'source')
    && term.reviewState === 'pending'));
});

// Scenario: M05-M08 and the separate A17 record are merged into one fixed-scope row outcome file.
// Purpose: Make every original migration row reviewable while preserving pending, retained, and owner-readback states.
test('UnitT50_builds_a_unique_4710_row_outcome_overlay_without_promoting_pending_content', async () => {
  const overlay = await buildW15MigrationOverlay();
  assert.equal(overlay.rows.length, 4710);
  assert.equal(new Set(overlay.rows.map(row => row.entryId)).size, 4710);
  assert.deepEqual(overlay.groups.map(group => [group.groupId, group.rowCount]), [
    ['M05', 1291], ['M06', 771], ['M07', 8], ['M08', 2623], ['A17', 17],
  ]);
  assert.equal(overlay.publicationEligible, false);
  assert.equal(overlay.decisions.gameContentApprovalCreated, false);
  assert.equal(overlay.decisions.pendingReviewRows, 3851);
  assert.equal(overlay.decisions.privateToolReadbackPendingRows, 0);
  assert.ok(overlay.rows.every(row => row.source?.path && row.source?.commit
    && row.target?.repoId && row.target?.path && row.disposition));
  assert.ok(overlay.rows.every(row => row.reviewState !== 'approved'));
});

// Scenario: A Windows checkout may normalize a generated documentation file from LF to CRLF.
// Purpose: Allow only this newline conversion in the portable Source candidate verifier while still rejecting changed content.
test('UnitT60_verifies_Source_candidate_after_CRLF_checkout_and_rejects_content_tampering', async () => {
  const sourceRoot = await mkdtemp(path.join(os.tmpdir(), 'w15-source-m08-'));
  const candidatePath = path.join(sourceRoot, 'docs/references/w15/term-candidates.json');
  try {
    const writeResult = spawnSync(process.execPath, [REPORT_SCRIPT, '--write-source-m08', sourceRoot], { encoding: 'utf8', timeout: 60000 });
    assert.equal(writeResult.status, 0, writeResult.stderr || 'Source candidate write command failed');
    const expected = await readFile(candidatePath, 'utf8');
    await writeFile(candidatePath, expected.replace(/\n/gu, '\r\n'), 'utf8');
    const crlfVerify = spawnSync(process.execPath, [REPORT_SCRIPT, '--verify-source-m08', sourceRoot], { encoding: 'utf8', timeout: 60000 });
    assert.equal(crlfVerify.status, 0, crlfVerify.stderr || 'CRLF-only checkout should preserve the candidate content');
    const crlfActual = await readFile(candidatePath, 'utf8');
    const tampered = crlfActual.replace('"reviewState": "pending"', '"reviewState": "approved"');
    assert.notEqual(tampered, crlfActual);
    await writeFile(candidatePath, tampered, 'utf8');
    const tamperedVerify = spawnSync(process.execPath, [REPORT_SCRIPT, '--verify-source-m08', sourceRoot], { encoding: 'utf8', timeout: 60000 });
    assert.equal(tamperedVerify.status, 1);
    assert.match(tamperedVerify.stderr, /differs from fixed W03 inputs/u);
  } finally {
    await rm(sourceRoot, { recursive: true, force: true });
  }
});
