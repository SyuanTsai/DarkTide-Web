import assert from 'node:assert/strict';
import test from 'node:test';

import { retainedNameProvenanceRows } from '../web/shared-render.mjs';

// Scenario: W08 retained-name evidence uses historyEvidence, without catalogEvidence.
// Purpose: Keep the player-facing provenance renderer aligned with the verified evidence shape.
test('UnitT10_RetainedNameHistoryEvidenceRendersFromPinnedSourceFields', () => {
  const rows = retainedNameProvenanceRows({
    sourceMarkId: 'combataxe_p1_m1',
    historyEvidence: {
      repository: 'SyuanTsai/DarkTide-Web',
      commit: '61f1dcda6cb80fb1ee2bf595b3b9a082825a912f',
      path: 'content/history/1.13.1/source-content.json',
      sourceSha256: 'a'.repeat(64),
    },
  });

  assert.deepEqual(rows, [
    ['型號 ID', 'combataxe_p1_m1'],
    ['留存資料來源', 'SyuanTsai/DarkTide-Web@61f1dcda6cb80fb1ee2bf595b3b9a082825a912f:content/history/1.13.1/source-content.json'],
    ['留存來源 SHA-256', 'a'.repeat(64)],
  ]);
});

// Scenario: An incomplete or legacy-shaped name provenance object lacks historyEvidence.
// Purpose: Render the available identity safely without dereferencing an unrelated dataRevision field.
test('UnitT20_RetainedNameProvenanceWithoutHistoryEvidenceDoesNotThrow', () => {
  assert.deepEqual(retainedNameProvenanceRows({
    sourceMarkId: 'combataxe_p1_m1',
    catalogEvidence: { dataRevision: 'unused-legacy-shape' },
  }), [['型號 ID', 'combataxe_p1_m1']]);
  assert.deepEqual(retainedNameProvenanceRows(null), []);
});
