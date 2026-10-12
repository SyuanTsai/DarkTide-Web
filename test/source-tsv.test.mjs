import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTsvSource, readTsvSelector } from '../src/content/source-selector.mjs';

const sourcePath = 'docs/darktide-skills/veteran.tsv';
const bytes = value => new TextEncoder().encode(value);

// Scenario: A fixed skill TSV contains a quoted value with a tab and newline.
// Purpose: Select the exact row field and derive archetype from the locked file path.
test('UnitT10_selects_exact_skill_tsv_row_and_archetype', () => {
  const document = parseTsvSource(bytes('id\tkind\tzh\r\npractice_guard\tcurrent-talent\t"演示\t防護\n技能"\r\n'), 'skill-tsv');
  assert.equal(readTsvSelector(document, 'tsv:row:practice_guard:zh', sourcePath), '演示\t防護\n技能');
  assert.equal(readTsvSelector(document, 'tsv:row:practice_guard:kind', sourcePath), 'current-talent');
  assert.equal(readTsvSelector(document, 'tsv:archetype', sourcePath), 'veteran');
});

// Scenario: Two TSV rows repeat the same skill ID.
// Purpose: Reject ambiguous field provenance instead of taking one row arbitrarily.
test('UnitT20_rejects_duplicate_tsv_skill_id', () => {
  assert.throws(() => parseTsvSource(bytes('id\tzh\npractice_guard\t甲\npractice_guard\t乙\n'), 'skill-tsv'),
    /duplicate.*TSV.*id/i);
});

// Scenario: A selector asks for an absent ID, unknown column, or another path namespace.
// Purpose: Keep row and archetype evidence tied to a unique fixed source location.
test('UnitT30_rejects_missing_tsv_field_or_wrong_path', () => {
  const document = parseTsvSource(bytes('id\tzh\npractice_guard\t演示防護\n'), 'skill-tsv');
  assert.throws(() => readTsvSelector(document, 'tsv:row:missing:zh', sourcePath), /TSV.*row/i);
  assert.throws(() => readTsvSelector(document, 'tsv:row:practice_guard:effect', sourcePath), /TSV.*field/i);
  assert.throws(() => readTsvSelector(document, 'tsv:archetype', 'docs/other/veteran.tsv'), /TSV.*path/i);
});

// Scenario: Quoting or column count is malformed in a fixed TSV blob.
// Purpose: Fail the whole source before attributing any row values to it.
test('UnitT40_rejects_malformed_tsv_source', () => {
  assert.throws(() => parseTsvSource(bytes('id\tzh\npractice_guard\t"unfinished'), 'skill-tsv'), /invalid TSV/i);
  assert.throws(() => parseTsvSource(bytes('id\tzh\npractice_guard\n'), 'skill-tsv'), /invalid TSV/i);
});
