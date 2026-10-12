import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// Scenario: All published player-facing descriptions are loaded from the production data.
// Purpose: Prevent internal execution vocabulary from leaking into skill and blessing explanations.
test('InterT10_player_descriptions_use_gameplay_language_without_internal_execution_terms', async () => {
  const content = JSON.parse(await readFile(new URL('../content/published/content.json', import.meta.url), 'utf8'));
  const jargon = /\b(?:tier|helper|proc|hitscan|hip|zoom|raw|minion|buff|tick|powered|stun|pellet|jab|heavy|slug)\b|時間戳|統計快取|修正池|伺服器端|程式會|呼叫|請求|讀取|寫入|力量修正|攻擊力量/i;
  const failures = [];
  for (const kind of ['skills', 'blessings', 'variants', 'weapons', 'marks']) {
    for (const row of content[kind]) for (const key of ['effect_zh_tw', 'mechanics_zh_tw', 'trigger_zh_tw']) {
      if (typeof row[key] === 'string' && jargon.test(row[key])) failures.push({ kind, id: row.skill_id ?? row.variant_id ?? row.blessing_id ?? row.weapon_id ?? row.mark_id, field: key });
    }
  }
  assert.deepEqual(failures, [], 'player descriptions must explain gameplay rather than code execution');
});
