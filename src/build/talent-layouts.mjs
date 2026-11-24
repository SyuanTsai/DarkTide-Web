import { readFile } from 'node:fs/promises';

export const talentLayoutRepository = 'Aussiemon/Darktide-Source-Code';
export const talentLayoutVersionPattern = /^\d+\.\d+\.\d+$/;
export const talentLayoutCommitPattern = /^[0-9a-f]{40}$/i;

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = value => typeof value === 'string' && value.trim().length > 0;

export function validateTalentLayouts(layouts, label) {
  function requireField(condition, field) {
    if (!condition) throw new Error(`Invalid talent layouts in ${label}: ${field}`);
  }

  requireField(layouts?.schemaVersion === '1.0.0', 'schemaVersion');
  requireField(text(layouts.gameVersion) && talentLayoutVersionPattern.test(layouts.gameVersion), 'gameVersion');
  const { source, trees } = layouts;
  requireField(object(source) && source.repository === talentLayoutRepository && text(source.commit)
    && talentLayoutCommitPattern.test(source.commit), 'source repository or commit');
  requireField(Array.isArray(source.files) && source.files.length > 0 && source.files.every(file => object(file)
    && text(file.path) && /^scripts\/(?:[\w-]+\/)*[\w-]+\.lua$/.test(file.path)
    && text(file.sha256) && /^[0-9a-f]{64}$/i.test(file.sha256)), 'source.files');
  requireField(new Set(source.files.map(file => file.path)).size === source.files.length, 'duplicate source file');
  requireField(Array.isArray(trees) && trees.length > 0, 'trees');
  for (const tree of trees) {
    requireField(object(tree) && text(tree.archetype) && text(tree.tree) && Number.isSafeInteger(tree.version)
      && Number.isFinite(tree.backgroundHeight) && Array.isArray(tree.nodes) && tree.nodes.length > 0, 'tree metadata');
    for (const node of tree.nodes) {
      requireField(object(node) && text(node.nodeId) && text(node.type)
        && typeof node.x === 'number' && typeof node.y === 'number' && (node.talent === null || text(node.talent))
        && Array.isArray(node.children) && node.children.every(text), `${tree.tree} node fields`);
    }
  }
  requireField(new Set(trees.map(tree => tree.tree)).size === trees.length, 'duplicate tree');
  return layouts;
}

export async function loadTalentLayouts(filename) {
  const bytes = await readFile(filename).catch(error => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  if (bytes === null) return null;
  let layouts;
  try {
    layouts = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch (cause) {
    throw new Error(`Invalid talent layouts in ${filename}: invalid JSON`, { cause });
  }
  return validateTalentLayouts(layouts, filename);
}
