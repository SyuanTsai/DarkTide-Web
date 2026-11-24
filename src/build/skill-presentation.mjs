import { compareUtf8 } from '../static/common.mjs';
import { isGamesLanternSkillImageUrl, skillTreeProblem } from '../../web/skill-presentation.mjs';

const publishedArchetypes = new Map([
  ['arbites', 'adamant'],
  ['scum', 'broker'],
  ['skitarii', 'cryptic'],
]);
const defaultCredit = '圖示 © Games Lantern';

function publishedTree(layout, layoutGameVersion) {
  const archetype = publishedArchetypes.get(layout?.archetype) ?? layout?.archetype;
  return {
    archetype,
    tree: `${archetype}_tree`,
    version: layout?.version,
    layoutGameVersion,
    nodes: Array.isArray(layout?.nodes) ? layout.nodes.map(node => ({
      nodeId: node?.node_id,
      type: node?.type,
      x: node?.x,
      y: node?.y,
      skillId: node?.skill_id === null ? null : `darktide:skill:${archetype}:${node?.skill_id}`,
      children: Array.isArray(node?.children) ? [...node.children] : node?.children,
    })) : null,
  };
}

function referenceTree(layout, layouts) {
  const { archetype, tree, version, nodes } = layout;
  const { repository, commit } = layouts.source;
  return {
    archetype, tree, version, layoutGameVersion: layouts.gameVersion, layoutSource: { repository, commit },
    nodes: Array.isArray(nodes) ? nodes.map(node => ({
      nodeId: node?.nodeId, type: node?.type, x: node?.x, y: node?.y,
      skillId: node?.talent ? `darktide:skill:${archetype}:${node.talent}` : null,
      children: Array.isArray(node?.children) ? [...node.children] : node?.children,
    })) : null,
  };
}

export function buildSkillPresentation({ published, skills, gameVersion, layouts = null }) {
  const assetsByHref = new Map();
  for (const { attribution } of published?.assets ?? []) {
    if (isGamesLanternSkillImageUrl(attribution?.href) && !assetsByHref.has(attribution.href)) {
      const text = attribution.text;
      assetsByHref.set(attribution.href, typeof text === 'string' && text.trim() ? text : defaultCredit);
    }
  }
  const skillsById = new Map(skills.items.map(item => [item.id, item]));
  const icons = {};
  for (const id of [...skillsById.keys()].sort(compareUtf8)) {
    const { key, values: { archetype, nodeType } } = skillsById.get(id);
    const src = `https://gameslantern.com/storage/sites/darktide/exporter/talents/${archetype}/${nodeType}/${key}.webp`;
    if (assetsByHref.has(src)) icons[id] = { src, creditHref: src, creditText: assetsByHref.get(src) };
  }

  const trees = [];
  const warnings = [];
  const matchingLayouts = layouts?.gameVersion === gameVersion;
  const nameValues = {};
  for (const key of Object.keys((matchingLayouts && layouts.nameFormatValues) || {}).sort(compareUtf8)) {
    const id = `darktide:skill:broker:${key}`;
    if (skillsById.has(id)) nameValues[id] = layouts.nameFormatValues[key];
  }
  const candidates = matchingLayouts
    ? layouts.trees.map(layout => referenceTree(layout, layouts))
    : (published?.talent_trees ?? []).map(layout => publishedTree(layout, published.game_version));
  for (const tree of candidates) {
    const problem = skillTreeProblem(tree, skillsById);
    if (problem) warnings.push(`skill-presentation ${gameVersion}/${tree.tree}: ${problem}`);
    else trees.push(tree);
  }
  trees.sort((a, b) => compareUtf8(a.archetype, b.archetype) || compareUtf8(a.tree, b.tree));
  warnings.sort(compareUtf8);
  return { document: { schemaVersion: '1.0.0', gameVersion, category: 'skill-presentation', icons, nameValues, trees }, warnings };
}
