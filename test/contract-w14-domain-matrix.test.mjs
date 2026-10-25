import test from 'node:test';
import assert from 'node:assert/strict';

import { summarizeW14HistoryProjection, summarizeW14SharedPackage } from '../scripts/content/build-w14-domain-matrix.mjs';

const record = (recordId, gameReleaseId = 'darktide:1.13.2', kind = 'claim') => ({
  recordId, gameReleaseId, kind, owner: 'source', payload: { stable: true },
});

function domain(name, records, web = {}) {
  return {
    kind: name,
    gameReleaseId: 'darktide:1.13.2',
    source: { records },
    web: {
      presentations: [], termLocalizations: [], announcements: [], gameChanges: [],
      officialTextChanges: [], reviewTargets: [], ...web,
    },
  };
}

// Scenario: the same approved Source identity is repeated across typed domain closures.
// Purpose: count unique identities without losing per-domain copies, and reject conflicting copies.
// Given all four W08 domains and a technical packet; when summarizing the exact package; then current identities are reconciled by release and stable ID, while same-ID conflicts fail closed.
test('UnitT10_shared-domain-matrix-deduplicates-identical-copies-and-rejects-conflicts', () => {
  const current = record('darktide:skill:test');
  const historical = record('darktide:evidence:old', 'darktide:1.13.1', 'evidence');
  const domains = {
    skills: domain('skills', [current, historical], { presentations: [{ entityRef: { recordId: current.recordId } }], reviewTargets: [{ target: 'skill' }] }),
    blessings: domain('blessings', [current], { presentations: [{ entityRef: { recordId: current.recordId } }], reviewTargets: [{ target: 'blessing' }] }),
    weapons: domain('weapons', [current], { reviewTargets: [{ target: 'weapon' }] }),
    terms: domain('terms', [historical], { termLocalizations: [{ termRef: { recordId: historical.recordId } }], reviewTargets: [{ target: 'term' }] }),
  };

  const summary = summarizeW14SharedPackage({
    domains,
    technicalRecords: [current, historical],
    gameReleaseId: 'darktide:1.13.2',
  });
  assert.equal(summary.domainCount, 4);
  assert.equal(summary.recordCopyCount, 5);
  assert.equal(summary.uniqueRecordCount, 2);
  assert.equal(summary.currentRecordCount, 1);
  assert.equal(summary.historicalRecordCount, 1);
  assert.equal(summary.webPresentationCount, 2);
  assert.equal(summary.termLocalizationCount, 1);
  assert.equal(summary.webReviewTargetCount, 4);
  assert.throws(() => summarizeW14SharedPackage({
    domains: { ...domains, weapons: domain('weapons', [{ ...current, payload: { stable: false } }]) },
    technicalRecords: [current, historical],
    gameReleaseId: 'darktide:1.13.2',
  }), /conflicting Source record copies/);
});

// Scenario: a candidate-only shared package contains current and historical game releases.
// Purpose: prevent the domain matrix from presenting old approved records as current targets.
// Given two records with the same stable ID in distinct releases; when summarizing their domains; then release-qualified identities remain separate and only the requested release counts as current.
test('UnitT20_shared-domain-matrix-keeps-historical-identities-out-of-current-counts', () => {
  const current = record('darktide:evidence:shared-id', 'darktide:1.13.2', 'evidence');
  const historical = record('darktide:evidence:shared-id', 'darktide:1.13.1', 'evidence');
  const domains = {
    skills: domain('skills', [current, historical]),
    blessings: domain('blessings', []),
    weapons: domain('weapons', []),
    terms: domain('terms', []),
  };
  const result = summarizeW14SharedPackage({ domains, technicalRecords: [current, historical], gameReleaseId: 'darktide:1.13.2' });
  assert.equal(result.uniqueRecordCount, 2);
  assert.equal(result.currentRecordCount, 1);
  assert.equal(result.historicalRecordCount, 1);
  assert.deepEqual(result.recordIdentities.map(row => row.gameReleaseId).sort(), ['darktide:1.13.1', 'darktide:1.13.2']);
});

// Scenario: the fixed 1.13.1 source backup has entries omitted from its Traditional Chinese player index.
// Purpose: distinguish source inventory totals from actually shipped player-readable rows and account for each omission.
// Given source counts of two skills with one projection omission; when summarizing the fixed index; then only one displayed skill is counted and a misbound projection is rejected.
test('UnitT30_history-matrix-separates-source-counts-projection-and-exclusions', () => {
  const kinds = ['skills', 'weapons', 'blessings', 'marks', 'variants'];
  const sourceCounts = Object.fromEntries(kinds.map(kind => [kind, kind === 'skills' ? 2 : 0]));
  const projectedCounts = Object.fromEntries(kinds.map(kind => [kind, kind === 'skills' ? 1 : 0]));
  const excludedCounts = Object.fromEntries(kinds.map(kind => [kind, kind === 'skills' ? 1 : 0]));
  const excludedReasons = Object.fromEntries(kinds.map(kind => [kind, {
    missingTraditionalChineseName: kind === 'skills' ? 1 : 0,
    missingLocalizedParent: 0,
  }]));
  const result = summarizeW14HistoryProjection({
    manifest: { projection: { counts: projectedCounts, excludedCounts, excludedReasons } },
    index: { counts: sourceCounts, entries: [{ kind: 'skill' }] },
  });
  assert.equal(result.sourceCounts.skills, 2);
  assert.equal(result.projectedCounts.skills, 1);
  assert.equal(result.excludedCounts.skills, 1);
  assert.equal(result.projectedEntryCount, 1);
  assert.throws(() => summarizeW14HistoryProjection({
    manifest: { projection: { counts: { ...projectedCounts, skills: 2 }, excludedCounts, excludedReasons } },
    index: { counts: sourceCounts, entries: [{ kind: 'skill' }] },
  }), /source\/projected\/excluded counts do not reconcile/);
});
