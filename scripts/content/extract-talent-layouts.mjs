import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compareUtf8, sha256 } from '../../src/static/common.mjs';
import {
  talentLayoutCommitPattern, talentLayoutRepository, talentLayoutVersionPattern, validateTalentLayouts,
} from '../../src/build/talent-layouts.mjs';

const layoutPaths = [
  ...['adamant', 'broker', 'cryptic', 'ogryn', 'psyker', 'veteran', 'zealot'].map(archetype =>
    `scripts/ui/views/talent_builder_view/layouts/${archetype}_tree.lua`),
  'scripts/ui/views/broker_stimm_builder_view/layouts/broker_stimm_tree.lua',
].sort(compareUtf8);
const brokerSettingsPath = 'scripts/settings/talent/talent_settings_broker.lua';
const romanNumerals = [
  [1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'],
  [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I'],
];
const keywords = new Set('and break do else elseif end false for function goto if in local nil not or repeat return then true until while'.split(' '));
const escapes = { a: '\x07', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t', v: '\v', '\\': '\\', '"': '"', "'": "'" };

export function parseLuaLayout(source, label = 'Lua layout') {
  const input = source.replace(/^\uFEFF/, '');
  const trivia = /(?:[ \t\r\n\f\v]+|--(?!\[=*\[)[^\r\n]*)*/y;
  const tokens = /(?<identifier>[A-Za-z_]\w*)|(?<number>-?(?:\d+(?:\.\d*)?|\.\d+))|(?<string>"(?:[^"\\\r\n]|\\[^\r\n])*"|'(?:[^'\\\r\n]|\\[^\r\n])*')|[{},=]/y;
  let offset = 0;
  const fail = (message, at = offset) => { throw new Error(`${label}:${at + 1}: ${message}`); };

  function next() {
    trivia.lastIndex = offset;
    trivia.exec(input);
    offset = trivia.lastIndex;
    if (offset === input.length) return { kind: 'end', offset };
    tokens.lastIndex = offset;
    const match = tokens.exec(input);
    if (!match) fail('unsupported Lua syntax');
    offset = tokens.lastIndex;
    return { text: match[0], kind: Object.keys(match.groups).find(key => match.groups[key] !== undefined), offset: match.index };
  }

  let token = next();
  function take(expected) {
    const current = token;
    if (expected !== undefined && current.text !== expected) fail(`expected ${expected}`, current.offset);
    token = next();
    return current;
  }

  function table() {
    const sequence = [];
    const named = Object.create(null);
    while (token.text !== '}') {
      const field = take();
      if (field.kind === 'identifier' && token.text === '=') {
        if (keywords.has(field.text) || Object.hasOwn(named, field.text)) fail('invalid or duplicate Lua field', field.offset);
        take('=');
        named[field.text] = value(take());
      } else {
        sequence.push(value(field));
      }
      if (token.text !== '}') take(',');
    }
    take('}');
    if (Object.keys(named).length === 0) return sequence;
    for (const [index, entry] of sequence.entries()) named[index + 1] = entry;
    return named;
  }

  function value(field) {
    if (field.text === '{') return table();
    if (field.text === 'true') return true;
    if (field.text === 'false') return false;
    if (field.text === 'nil') return null;
    if (field.kind === 'number') {
      const number = Number(field.text);
      if (!Number.isFinite(number)) fail('invalid Lua number', field.offset);
      return number;
    }
    if (field.kind === 'string') {
      return field.text.slice(1, -1).replace(/\\(.)/gs, (_, escape) => {
        if (!Object.hasOwn(escapes, escape)) fail('unsupported Lua string escape', field.offset);
        return escapes[escape];
      });
    }
    fail('expected a Lua literal', field.offset);
  }

  take('return');
  take('{');
  const layout = table();
  if (token.kind !== 'end') fail('unexpected data after Lua table', token.offset);
  return layout;
}

export function projectTalentLayout(lua, relativePath) {
  if (lua.name !== path.posix.basename(relativePath, '.lua')) throw new Error(`Unexpected tree name in ${relativePath}`);
  if (!Array.isArray(lua.nodes)) throw new Error(`Expected a node array in ${relativePath}`);
  const nodeIds = new Set(lua.nodes.map(node => node?.widget_name));
  return {
    archetype: lua.archetype_name, tree: lua.name, version: lua.version, backgroundHeight: lua.background_height,
    // Lua retains some edges to removed nodes and uses not_selected for an empty talent slot.
    nodes: lua.nodes.map(node => ({
      nodeId: node?.widget_name, type: node?.type, x: node?.x, y: node?.y,
      talent: node?.talent === 'not_selected' ? null : node?.talent ?? null,
      children: Array.isArray(node?.children) ? node.children.filter(id =>
        typeof id !== 'string' || nodeIds.has(id)) : node?.children,
    })),
  };
}

export function parseStimmNameFormatValues(source, label = brokerSettingsPath) {
  // Skip comments, strings and the helper declaration while looking for call sites.
  const calls = /(?:--)?\[(=*)\[[\s\S]*?\]\1\]|--[^\r\n]*|"(?:[^"\\]|\\[\s\S])*"|'(?:[^'\\]|\\[\s\S])*'|\bfunction\s+_generate_stimm_talent\s*\(|(?<call>\b_generate_stimm_talent\s*\()/g;
  const argumentsPrefix = /\s*"([A-Za-z_]\w*)"\s*,\s*"[A-Za-z_]\w*"\s*,\s*(\d+|nil)\s*,(?=\s*[^\s,)])/y;
  const values = new Map();
  for (const match of source.matchAll(calls)) {
    if (!match.groups.call) continue;
    argumentsPrefix.lastIndex = match.index + match[0].length;
    const args = argumentsPrefix.exec(source);
    if (!args) throw new Error(`${label}:${match.index + 1}: invalid _generate_stimm_talent arguments`);
    const [, talent, literal] = args;
    if (values.has(talent)) throw new Error(`${label}: duplicate stimm talent ${talent}`);
    let tier = '';
    if (literal !== 'nil') {
      let remaining = Number(literal);
      if (remaining < 1 || remaining > 3999) throw new Error(`${label}: invalid tier for ${talent}: ${literal}`);
      for (const [number, numeral] of romanNumerals) {
        tier += numeral.repeat(Math.floor(remaining / number));
        remaining %= number;
      }
    }
    values.set(talent, { tier });
  }
  if (!values.size) throw new Error(`${label}: no _generate_stimm_talent calls found`);
  return Object.fromEntries(values);
}

export function extractTalentLayouts({ source, commit, gameVersion }) {
  if (!talentLayoutCommitPattern.test(commit) || !talentLayoutVersionPattern.test(gameVersion)) {
    throw new Error('Expected a 40-character hex commit and an x.y.z game version');
  }
  const head = execFileSync('git', ['-C', source, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  if (head !== commit.toLowerCase()) throw new Error(`Source HEAD ${head} does not match requested commit ${commit}`);

  const files = [];
  const trees = [];
  let nameFormatValues;
  for (const relativePath of [...layoutPaths, brokerSettingsPath].sort(compareUtf8)) {
    // Hash and parse the pinned blob so checkout line endings cannot change the reference.
    const bytes = execFileSync('git', ['-C', source, 'cat-file', 'blob', `${head}:${relativePath}`]);
    const lua = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    files.push({ path: relativePath, sha256: sha256(bytes) });
    if (relativePath === brokerSettingsPath) nameFormatValues = parseStimmNameFormatValues(lua, relativePath);
    else trees.push(projectTalentLayout(parseLuaLayout(lua, relativePath), relativePath));
  }
  // The activation node is defined separately in broker_talents.lua and has no tier.
  const activation = 'broker_stimm_activation_talent';
  const stimmTree = trees.find(tree => tree.tree === 'broker_stimm_tree');
  if (stimmTree.nodes.some(node => node.type === 'start' && node.talent === activation)
      && !Object.hasOwn(nameFormatValues, activation)) nameFormatValues[activation] = { tier: '' };
  nameFormatValues = Object.fromEntries(Object.keys(nameFormatValues).sort(compareUtf8)
    .map(talent => [talent, nameFormatValues[talent]]));
  trees.sort((a, b) => compareUtf8(a.tree, b.tree));
  return validateTalentLayouts({ schemaVersion: '1.0.0', gameVersion,
    source: { repository: talentLayoutRepository, commit: head, files }, nameFormatValues, trees }, source);
}

async function main(args) {
  const keys = new Map([['--source', 'source'], ['--commit', 'commit'], ['--game-version', 'gameVersion'], ['--out', 'out']]);
  const options = {};
  for (let i = 0; i < args.length; i += 2) {
    const key = keys.get(args[i]);
    if (!key || Object.hasOwn(options, key) || !args[i + 1] || args[i + 1].startsWith('--')) break;
    options[key] = args[i + 1];
  }
  if (args.length !== keys.size * 2 || Object.keys(options).length !== keys.size) {
    throw new Error('Usage: node scripts/content/extract-talent-layouts.mjs --source <path> --commit <40 hex> --game-version <x.y.z> --out <file>');
  }
  const layouts = extractTalentLayouts(options);
  await mkdir(path.dirname(options.out), { recursive: true });
  await writeFile(options.out, JSON.stringify(layouts, null, 2) + '\n');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await main(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
