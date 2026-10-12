import path from 'node:path';
import { sha256, safeRelativePath, toBytes } from './common.mjs';

const IMPORT_PATTERN = /\b(?:import|export)\s+(?:[^'";]*?\s+from\s*)?(['"])([^'"]+)\1|\bimport\s*\(\s*(['"])([^'"]+)\3\s*\)/g;
const CSS_IMPORT_PATTERN = /@import\s+(?:url\(\s*)?(['"])([^'"]+)\1\s*\)?\s*;/g;
const HASHED_MODULE_PATTERN = /^\/assets\/([a-f0-9]{64})\.(mjs|js)$/;
const HASHED_STYLE_PATTERN = /^\/assets\/([a-f0-9]{64})\.css$/;

function decodeUtf8(bytes, label) {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch (error) { throw new Error(label + ' is not UTF-8', { cause: error }); }
}

function matches(source, pattern, mapMatch) {
  const result = [];
  pattern.lastIndex = 0;
  for (const match of source.matchAll(pattern)) {
    const mapped = mapMatch(match);
    if (mapped) result.push(mapped);
  }
  return result;
}

export function moduleSpecifiers(source) {
  return matches(source, IMPORT_PATTERN, match => ({
    specifier: match[2] ?? match[4],
    start: (match[2] === undefined ? match.index + match[0].lastIndexOf(match[4]) : match.index + match[0].lastIndexOf(match[2]))
  }));
}

function resolveLocal(from, specifier, extensionSet, label) {
  if (typeof specifier !== 'string' || !specifier.startsWith('./') && !specifier.startsWith('../')) {
    throw new Error(label + ' must use a local relative import: ' + specifier);
  }
  if (specifier.includes('?') || specifier.includes('#')) throw new Error(label + ' import may not include query or fragment');
  const target = path.posix.normalize(path.posix.join(path.posix.dirname(from), specifier));
  safeRelativePath(target, label + ' import path');
  if (!extensionSet.has(path.posix.extname(target))) throw new Error(label + ' import has unsupported extension: ' + specifier);
  return target;
}

function applyReplacements(source, replacements) {
  let result = source;
  for (const replacement of [...replacements].sort((a, b) => b.start - a.start)) {
    result = result.slice(0, replacement.start) + replacement.value + result.slice(replacement.end);
  }
  return result;
}

async function emitModule(sourceFiles, relative, cache, visiting, emitted) {
  if (cache.has(relative)) return cache.get(relative);
  if (visiting.has(relative)) throw new Error('cyclic ESM imports are unsupported: ' + relative);
  const original = sourceFiles.get(relative);
  if (original === undefined) throw new Error('module import is missing: ' + relative);
  visiting.add(relative);
  const source = decodeUtf8(toBytes(original, relative), relative);
  const replacements = [];
  for (const item of moduleSpecifiers(source)) {
    const dependency = resolveLocal(relative, item.specifier, new Set(['.mjs', '.js']), 'ES module');
    const output = await emitModule(sourceFiles, dependency, cache, visiting, emitted);
    const start = item.start - 1;
    replacements.push({ start, end: start + item.specifier.length + 2, value: '"' + '/' + output + '"' });
  }
  const rewritten = applyReplacements(source, replacements);
  const extension = path.posix.extname(relative);
  const name = 'assets/' + sha256(Buffer.from(rewritten, 'utf8')) + extension;
  const bytes = Buffer.from(rewritten, 'utf8');
  if (emitted.has(name) && !emitted.get(name).equals(bytes)) throw new Error('hashed module filename collision');
  emitted.set(name, bytes);
  visiting.delete(relative);
  cache.set(relative, name);
  return name;
}

async function emitStyle(sourceFiles, relative, cache, visiting, emitted) {
  if (cache.has(relative)) return cache.get(relative);
  if (visiting.has(relative)) throw new Error('cyclic CSS imports are unsupported: ' + relative);
  const original = sourceFiles.get(relative);
  if (original === undefined) throw new Error('stylesheet import is missing: ' + relative);
  visiting.add(relative);
  const source = decodeUtf8(toBytes(original, relative), relative);
  const replacements = [];
  CSS_IMPORT_PATTERN.lastIndex = 0;
  for (const match of source.matchAll(CSS_IMPORT_PATTERN)) {
    const specifier = match[2];
    const dependency = resolveLocal(relative, specifier, new Set(['.css']), 'CSS');
    const output = await emitStyle(sourceFiles, dependency, cache, visiting, emitted);
    const specifierStart = match.index + match[0].lastIndexOf(specifier);
    replacements.push({
      start: match.index,
      end: match.index + match[0].length,
      value: '@import "' + '/' + output + '";'
    });
    if (specifierStart < 0) throw new Error('invalid CSS import syntax');
  }
  const rewritten = applyReplacements(source, replacements);
  const name = 'assets/' + sha256(Buffer.from(rewritten, 'utf8')) + '.css';
  const bytes = Buffer.from(rewritten, 'utf8');
  if (emitted.has(name) && !emitted.get(name).equals(bytes)) throw new Error('hashed stylesheet filename collision');
  emitted.set(name, bytes);
  visiting.delete(relative);
  cache.set(relative, name);
  return name;
}

export async function buildHashedAssets(sourceFiles) {
  if (!(sourceFiles instanceof Map)) throw new Error('web source files must be a Map');
  for (const name of sourceFiles.keys()) safeRelativePath(name, 'web source path');
  for (const required of ['index.html', 'app.mjs', 'style.css']) {
    if (!sourceFiles.has(required)) throw new Error('web source is missing ' + required);
  }
  const emitted = new Map();
  const moduleEntry = await emitModule(sourceFiles, 'app.mjs', new Map(), new Set(), emitted);
  const styleEntry = await emitStyle(sourceFiles, 'style.css', new Map(), new Set(), emitted);
  const index = decodeUtf8(toBytes(sourceFiles.get('index.html'), 'web/index.html'), 'web/index.html');
  return { assets: emitted, index, moduleEntry: '/' + moduleEntry, styleEntry: '/' + styleEntry };
}

export function verifyHashedModuleGraph(indexHtml, assetFiles) {
  const moduleNames = new Set([...assetFiles.keys()].filter(name => /^assets\/[a-f0-9]{64}\.(?:mjs|js)$/.test(name)));
  const styleNames = new Set([...assetFiles.keys()].filter(name => /^assets\/[a-f0-9]{64}\.css$/.test(name)));
  const entryMatches = [...indexHtml.matchAll(/\bsrc=(['"])(\/assets\/[a-f0-9]{64}\.(?:mjs|js))\1/g)];
  const styleMatches = [...indexHtml.matchAll(/\bhref=(['"])(\/assets\/[a-f0-9]{64}\.css)\1/g)];
  if (entryMatches.length !== 1 || styleMatches.length !== 1) throw new Error('index.html must reference one hashed app module and one hashed stylesheet');
  const entry = entryMatches[0][2].slice(1);
  const style = styleMatches[0][2].slice(1);
  if (!moduleNames.has(entry) || !styleNames.has(style)) throw new Error('index.html references a missing hashed asset');

  for (const [name, bytes] of assetFiles) {
    const match = /^assets\/([a-f0-9]{64})\.(mjs|js|css)$/.exec(name);
    if (!match || sha256(toBytes(bytes, name)) !== match[1]) throw new Error('hashed asset filename does not match bytes: ' + name);
  }

  const reachedModules = new Set();
  const visit = name => {
    if (reachedModules.has(name)) return;
    const bytes = assetFiles.get(name);
    if (!bytes) throw new Error('module dependency is missing: ' + name);
    const text = decodeUtf8(toBytes(bytes, name), name);
    reachedModules.add(name);
    for (const item of moduleSpecifiers(text)) {
      const match = HASHED_MODULE_PATTERN.exec(item.specifier);
      if (!match) throw new Error('built module has an unrewritten or unsafe import: ' + item.specifier);
      const dependency = item.specifier.slice(1);
      if (!moduleNames.has(dependency)) throw new Error('module dependency is missing: ' + dependency);
      visit(dependency);
    }
  };
  visit(entry);
  if (reachedModules.size !== moduleNames.size) throw new Error('artifact includes an unreachable JavaScript module');
  const reachedStyles = new Set();
  const visitStyle = name => {
    if (reachedStyles.has(name)) return;
    const bytes = assetFiles.get(name);
    if (!bytes) throw new Error('stylesheet dependency is missing: ' + name);
    const text = decodeUtf8(toBytes(bytes, name), name);
    reachedStyles.add(name);
    CSS_IMPORT_PATTERN.lastIndex = 0;
    for (const match of text.matchAll(CSS_IMPORT_PATTERN)) {
      if (!HASHED_STYLE_PATTERN.test(match[2])) throw new Error('built stylesheet has an unrewritten or unsafe import: ' + match[2]);
      const dependency = match[2].slice(1);
      if (!styleNames.has(dependency)) throw new Error('stylesheet dependency is missing: ' + dependency);
      visitStyle(dependency);
    }
  };
  visitStyle(style);
  if (reachedStyles.size !== styleNames.size) throw new Error('artifact includes an unreachable stylesheet');
}

