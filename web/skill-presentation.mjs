export function isGamesLanternSkillImageUrl(value) {
  return typeof value === 'string'
    && /^https:\/\/gameslantern\.com\/storage\/sites\/darktide\/[A-Za-z0-9_./-]+\.(?:webp|png|jpe?g)$/.test(value)
    && !value.split('/').some(segment => segment === '.' || segment === '..');
}

export function skillTreeProblem(tree, skillsById) {
  const { archetype, nodes } = tree;
  if (typeof archetype !== 'string' || !archetype || tree.tree !== `${archetype}_tree`
      || !Number.isSafeInteger(tree.version) || typeof tree.layoutGameVersion !== 'string'
      || !tree.layoutGameVersion || !Array.isArray(nodes) || nodes.length === 0) {
    return 'invalid layout metadata';
  }
  const nodeIds = new Set();
  for (const node of nodes) {
    if (!node || typeof node.nodeId !== 'string' || !node.nodeId || typeof node.type !== 'string' || !node.type) {
      return 'invalid node ID or type';
    }
    if (nodeIds.has(node.nodeId)) return `duplicate node ID ${node.nodeId}`;
    nodeIds.add(node.nodeId);
    if (!Number.isFinite(node.x) || !Number.isFinite(node.y)) return `invalid coordinates for ${node.nodeId}`;
    if (!Array.isArray(node.children)) return `invalid children for ${node.nodeId}`;
    if (node.skillId !== null) {
      const skill = skillsById.get(node.skillId);
      if (!skill || skill.values.archetype !== archetype || skill.values.tree !== tree.tree) {
        return `skill ${node.skillId} at ${node.nodeId} is missing or belongs to another tree`;
      }
    }
  }
  for (const node of nodes) {
    for (const child of node.children) {
      if (!nodeIds.has(child)) return `unknown child ${child} at ${node.nodeId}`;
    }
  }
  return null;
}
