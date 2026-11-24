import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { parseLuaLayout, parseStimmNameFormatValues, projectTalentLayout } from '../scripts/content/extract-talent-layouts.mjs';

const run = promisify(execFile);
const reference = new URL('../content/reference/talent-layouts/1.13.4.json', import.meta.url);
const sourceCommit = 'e46b8926cfa3fa35503e4b80b15aab7a804314e4';

test('從 Lua 興奮劑技能呼叫抽取羅馬數字階級與空字串', () => {
  const lua = `
local function _generate_stimm_talent(talent_name, display_name, tier, description, icon_group)
end
-- _generate_stimm_talent("fake", "loc_fake", invalid, nil)
--[=[ _generate_stimm_talent("fake", "loc_fake", invalid, nil) ]=]
local example = '_generate_stimm_talent("fake", "loc_fake", invalid, nil)'
_generate_stimm_talent("broker_stimm_combat_4b", "loc_combat", 1, nil)
_generate_stimm_talent(
  "broker_stimm_celerity_4", "loc_celerity", 4, nil)
_generate_stimm_talent("broker_stimm_celerity_5a", "loc_celerity", 5, nil)
_generate_stimm_talent("broker_stimm_celerity_5b", "loc_celerity", nil, nil)
`;
  assert.deepEqual(parseStimmNameFormatValues(lua), {
    broker_stimm_combat_4b: { tier: 'I' },
    broker_stimm_celerity_4: { tier: 'IV' },
    broker_stimm_celerity_5a: { tier: 'V' },
    broker_stimm_celerity_5b: { tier: '' },
  });
  for (const tier of ['3.5', 'some_tier', '"4"', 'nil or 4', '4 + 1', '']) {
    assert.throws(() => parseStimmNameFormatValues(`${lua}\n_generate_stimm_talent("broken", "loc_broken", ${tier}, nil)`),
      /invalid _generate_stimm_talent arguments/, tier);
  }
});

test('Lua 抽取支援 BOM、字面值與含技能的起點，並清理遊戲編輯器留下的佔位資料', async () => {
  const fixture = new URL('fixtures/talent-layouts/broker_stimm_tree.lua', import.meta.url);
  const input = await readFile(fixture, 'utf8');
  assert.equal(input[0], '\uFEFF');
  const lua = parseLuaLayout(input);
  assert.equal(lua.nodes[0].icon, 'escaped "quote" and \\ -- still a string');
  assert.deepEqual({ ...lua.nodes[0].requirements }, { all_parents_chosen: false, unlocked: true, additional: null });
  assert.deepEqual(projectTalentLayout(lua, 'broker_stimm_tree.lua'), {
    archetype: 'broker', tree: 'broker_stimm_tree', version: 2, backgroundHeight: 480,
    nodes: [
      { nodeId: 'node_start', type: 'start', x: -12.5, y: 0.75, talent: 'broker_stimm_activation_talent', children: ['node_second'] },
      { nodeId: 'node_second', type: 'broker_stimm', x: 30, y: -2, talent: null, children: [] },
      { nodeId: 'node_third', type: 'broker_stimm', x: 60, y: 7, talent: null, children: [] },
    ],
  });
});

test('Lua 抽取遇到不支援的語法時失敗', () => {
  for (const input of [
    'return { x = 1 + 2 }', 'return { x = math.huge }', 'return { x = "\\q" }', 'return { x = 1 y = 2 }',
    'return { x = false', 'return {} return {}', 'local x = {}; return x', '--[[ long comment ]]\nreturn {}',
  ]) {
    assert.throws(() => parseLuaLayout(input), /Lua layout:\d+:/, input);
  }
});

test('1.13.4 參考檔包含興奮劑樹，七棵主樹的節點與 1.13.1 已發布版面一致', async () => {
  const [layouts, published] = await Promise.all([reference, new URL('../content/published/content.json', import.meta.url)]
    .map(async file => JSON.parse(await readFile(file, 'utf8'))));
  const names = { arbites: 'adamant', scum: 'broker', skitarii: 'cryptic' };
  assert.equal(layouts.gameVersion, '1.13.4');
  assert.equal(layouts.source.commit, sourceCommit);
  assert.equal(published.game_version, '1.13.1');
  assert.equal(layouts.source.files.length, 9);
  assert.ok(layouts.source.files.some(file => file.path === 'scripts/settings/talent/talent_settings_broker.lua'
    && /^[0-9a-f]{64}$/.test(file.sha256)));
  assert.equal(layouts.trees.length, 8);
  assert.deepEqual(layouts.trees.map(tree => tree.tree), layouts.trees.map(tree => tree.tree).sort());
  const stimm = layouts.trees.find(tree => tree.tree === 'broker_stimm_tree');
  assert.equal(stimm.nodes.length, 30);
  assert.equal(stimm.nodes.find(node => node.type === 'start').talent, 'broker_stimm_activation_talent');
  const nameKeys = Object.keys(layouts.nameFormatValues);
  assert.equal(nameKeys.length, 30);
  assert.deepEqual(nameKeys, stimm.nodes.map(node => node.talent).sort());
  for (const [key, tier] of Object.entries({
    broker_stimm_combat_4b: 'I', broker_stimm_celerity_4: 'IV', broker_stimm_celerity_5b: '', broker_stimm_activation_talent: '',
  })) assert.deepEqual(layouts.nameFormatValues[key], { tier });
  assert.equal(published.talent_trees.length, 7);
  for (const tree of published.talent_trees) {
    const archetype = names[tree.archetype] ?? tree.archetype;
    const extracted = layouts.trees.find(entry => entry.tree === `${archetype}_tree`);
    assert.equal(extracted.archetype, archetype);
    assert.deepEqual(extracted.nodes, tree.nodes.map(node => ({
      nodeId: node.node_id, type: node.type, x: node.x, y: node.y, talent: node.skill_id, children: node.children,
    })), extracted.tree);
  }
});

test('從指定本機遊戲原始碼重建的參考檔可以逐位元組重現', async t => {
  const source = 'F:/GitFile/Persion - Games/Darktide-Source-Code';
  try {
    await stat(source);
  } catch (error) {
    if (error.code === 'ENOENT') return t.skip('本機沒有遊戲原始碼 checkout');
    throw error;
  }
  const configIndex = Number(process.env.GIT_CONFIG_COUNT || 0);
  const env = { ...process.env, GIT_CONFIG_COUNT: String(configIndex + 1),
    [`GIT_CONFIG_KEY_${configIndex}`]: 'safe.directory', [`GIT_CONFIG_VALUE_${configIndex}`]: source };
  const { stdout } = await run('git', ['-C', source, 'rev-parse', 'HEAD'], { env });
  if (stdout.trim() !== sourceCommit) return t.skip(`本機遊戲原始碼 HEAD 為 ${stdout.trim()}`);

  const temp = await mkdtemp(join(tmpdir(), 'syp549-layouts-'));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const script = fileURLToPath(new URL('../scripts/content/extract-talent-layouts.mjs', import.meta.url));
  const output = join(temp, '1.13.4.json');
  const args = [script, '--source', source, '--game-version', '1.13.4', '--out', output, '--commit'];
  await assert.rejects(run(process.execPath, [...args, '0'.repeat(40)], { env }), /does not match requested commit/);
  await run(process.execPath, [...args, sourceCommit], { env });
  assert.deepEqual(await readFile(output), await readFile(reference));
});
