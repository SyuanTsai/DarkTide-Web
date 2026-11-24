import { compareUtf8 } from '../static/common.mjs';
import { isGamesLanternSkillImageUrl, skillTreeProblem } from '../../web/skill-presentation.mjs';

const publishedArchetypes = new Map([
  ['arbites', 'adamant'],
  ['scum', 'broker'],
  ['skitarii', 'cryptic'],
]);
const defaultCredit = '圖示 © Games Lantern';

export function buildSkillPresentation({ published, skills, gameVersion }) {
  const assetsByHref = new Map();
  for (const { attribution } of published.assets ?? []) {
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
  for (const layout of published.talent_trees ?? []) {
    const archetype = publishedArchetypes.get(layout?.archetype) ?? layout?.archetype;
    const tree = {
      archetype,
      tree: `${archetype}_tree`,
      version: layout?.version,
      layoutGameVersion: published.game_version,
      nodes: Array.isArray(layout?.nodes) ? layout.nodes.map(node => ({
        nodeId: node?.node_id,
        type: node?.type,
        x: node?.x,
        y: node?.y,
        skillId: node?.skill_id === null ? null : `darktide:skill:${archetype}:${node?.skill_id}`,
        children: Array.isArray(node?.children) ? [...node.children] : node?.children,
      })) : null,
    };
    const problem = skillTreeProblem(tree, skillsById);
    if (problem) warnings.push(`skill-presentation ${gameVersion}/${tree.tree}: ${problem}`);
    else trees.push(tree);
  }
  trees.sort((a, b) => compareUtf8(a.archetype, b.archetype));
  warnings.sort(compareUtf8);
  return { document: { schemaVersion: '1.0.0', gameVersion, category: 'skill-presentation', icons, trees }, warnings };
}
