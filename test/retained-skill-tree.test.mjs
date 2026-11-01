import test from 'node:test';
import assert from 'node:assert/strict';

import { shouldRenderSkillMechanics } from '../web/shared-render.mjs';

// Scenario: Retained effect and mechanics fields contain the same text, including source line-ending or trailing-space differences.
// Purpose: Avoid showing the same verified 1.13.1 explanation twice in a talent-tree detail panel.
test('UnitT10_hides_duplicate_skill_mechanics_text', () => {
  assert.equal(shouldRenderSkillMechanics('火力齊射\r\n冷卻 30 秒。  ', '火力齊射\n冷卻 30 秒。'), false);
});

// Scenario: The mechanics field is either distinct from the effect or is the only populated field.
// Purpose: Preserve useful separate mechanics and avoid dropping standalone mechanics text.
test('UnitT20_keeps_distinct_or_standalone_skill_mechanics', () => {
  assert.equal(shouldRenderSkillMechanics('技能效果', '額外機制說明'), true);
  assert.equal(shouldRenderSkillMechanics('', '獨立機制說明'), true);
  assert.equal(shouldRenderSkillMechanics('技能效果', ''), false);
});
