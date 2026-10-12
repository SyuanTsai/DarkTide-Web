import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from '../fixtures/site.mjs';
import { createPublicFiles, projectPublicContent, validatePublicFiles, validatePublishedContent } from '../src/published/contract.mjs';

const TREE_TYPES = [
  'default', 'ability', 'ability_modifier', 'aura', 'keystone', 'keystone_modifier',
  'start', 'stat', 'tactical', 'tactical_modifier'
];

function treeModel() {
  const data = projectPublicContent(structuredClone(fixture));
  data.skills[0].source_ids = ['skill-source'];
  data.sources = [
    { source_id: 'layout-source', label: '技能樹版面來源', url: 'https://example.com/tree' },
    { source_id: 'skill-source', label: '技能來源', url: 'https://example.com/skill' }
  ];
  data.talent_trees = [{
    archetype: 'veteran',
    version: 1,
    nodes: [
      { node_id: 'node-a', type: 'default', x: 0, y: 0, skill_id: 'practice-guard', children: ['node-b', 'node-c'] },
      { node_id: 'node-b', type: 'ability', x: 1.25, y: -2.5, skill_id: 'practice-guard', children: ['node-c'] },
      { node_id: 'node-c', type: 'keystone', x: 3, y: 4, skill_id: null, children: [] }
    ],
    source_ids: ['layout-source']
  }];
  return data;
}

function readJson(files, path) { return JSON.parse(files.get(path)); }
function writeJson(files, path, value) { files.set(path, JSON.stringify(value, null, 2) + '\n'); }

// Scenario: A pre-tree schema-v1 package has no talent_trees field.
// Purpose: Keep old packages valid and project the optional feature as an empty array without changing their catalog shape.
test('UnitT00_accepts_legacy_content_without_talent_trees_and_projects_whitelisted_tree_fields', () => {
  const legacy = projectPublicContent(structuredClone(fixture));
  assert.deepEqual(legacy.talent_trees, []);
  assert.doesNotThrow(() => validatePublishedContent(legacy));
  const legacyFiles = createPublicFiles(legacy);
  assert.equal(Object.hasOwn(readJson(legacyFiles, 'catalog.json'), 'talent_trees'), false);

  const raw = structuredClone(fixture);
  raw.talent_trees = [{
    archetype: 'veteran', version: 1, private_note: 'drop me', source_ids: [],
    nodes: [{ node_id: 'node-a', type: 'default', x: 1, y: -1, skill_id: null, children: [], private_icon_path: 'secret' }]
  }];
  const projected = projectPublicContent(raw);
  assert.deepEqual(projected.talent_trees, [{
    archetype: 'veteran', version: 1, source_ids: [],
    nodes: [{ node_id: 'node-a', type: 'default', x: 1, y: -1, skill_id: null, children: [] }]
  }]);
  assert.doesNotThrow(() => validatePublishedContent(projected));
});

// Scenario: A complete tree contains valid nodes, same-archetype skill links, source IDs, and child edges.
// Purpose: Generate a compact tree file whose referenced details exactly reuse the canonical skill detail payload.
test('InterT00_generates_tree_catalog_file_sources_and_deduplicated_canonical_skill_details', () => {
  const data = treeModel();
  assert.doesNotThrow(() => validatePublishedContent(data));
  for (const type of TREE_TYPES) {
    const candidate = treeModel();
    candidate.talent_trees[0].nodes[0].type = type;
    assert.doesNotThrow(() => validatePublishedContent(candidate), type);
  }
  const files = createPublicFiles(data);
  const catalog = readJson(files, 'catalog.json');
  assert.deepEqual(catalog.talent_trees, [{
    archetype: 'veteran', version: 1, tree_path: 'trees/veteran.json', node_count: 3
  }]);
  const tree = readJson(files, 'trees/veteran.json');
  assert.deepEqual(Object.keys(tree).sort(), ['archetype', 'details', 'nodes', 'schema_version', 'source_ids', 'sources', 'version']);
  assert.equal(tree.schema_version, 2);
  assert.equal(tree.archetype, 'veteran');
  assert.equal(tree.version, 1);
  assert.deepEqual(tree.nodes, data.talent_trees[0].nodes);
  assert.deepEqual(tree.source_ids, ['layout-source']);
  assert.deepEqual(tree.sources.map(source => source.source_id), ['layout-source']);
  const skillEntry = catalog.entries.find(entry => entry.kind === 'skill' && entry.id === 'veteran/practice-guard');
  const canonicalSkillDetail = readJson(files, skillEntry.detail_path);
  assert.deepEqual(tree.details, [canonicalSkillDetail]);
  assert.deepEqual([...files.keys()].filter(path => path.startsWith('trees/')), ['trees/veteran.json']);
  assert.doesNotThrow(() => validatePublicFiles(files));
});

// Scenario: Tree inputs contain unsupported fields, types, versions, coordinates, duplicate identities, or unresolved references.
// Purpose: Reject incomplete or guessed layouts before either contract validation or public generation.
test('UnitT01_rejects_malformed_tree_schema_coordinates_and_references', () => {
  const invalidCases = [
    ['unknown tree field', data => { data.talent_trees[0].private_note = 'x'; }, /unknown or unsupported field/u],
    ['unknown node field', data => { data.talent_trees[0].nodes[0].icon_path = 'icons/private.svg'; }, /unknown or unsupported field/u],
    ['unknown type', data => { data.talent_trees[0].nodes[0].type = 'invented'; }, /node type/u],
    ['zero version', data => { data.talent_trees[0].version = 0; }, /version/u],
    ['empty nodes', data => { data.talent_trees[0].nodes = []; }, /nodes.*nonempty/u],
    ['infinite coordinate', data => { data.talent_trees[0].nodes[0].x = Infinity; }, /coordinate/u],
    ['duplicate node', data => { data.talent_trees[0].nodes[1].node_id = 'node-a'; }, /duplicate.*node/u],
    ['dangling child', data => { data.talent_trees[0].nodes[0].children = ['missing-node']; }, /child.*unknown|unknown.*child/u],
    ['wrong-archetype skill', data => {
      data.skills[0].archetype = 'psyker';
      for (const route of data.routes) {
        if (route.content_key === 'veteran/practice-guard') {
          route.content_key = 'psyker/practice-guard';
          route.target_route = route.content_kind === 'skill'
            ? '/skills/psyker/practice-guard/'
            : '/skills/psyker/practice-guard/mechanics/';
        }
      }
    }, /same archetype|tree.*skill|skill.*tree/u],
    ['unknown tree source', data => { data.talent_trees[0].source_ids = ['missing-source']; }, /unknown.*source/u],
    ['duplicate archetype', data => { data.talent_trees.push(structuredClone(data.talent_trees[0])); }, /duplicate.*archetype/u]
  ];
  for (const [label, mutate, expected] of invalidCases) {
    const data = treeModel();
    mutate(data);
    assert.throws(() => validatePublishedContent(data), expected, label);
  }

  const duplicateAcrossTrees = treeModel();
  const second = structuredClone(duplicateAcrossTrees.talent_trees[0]);
  second.archetype = 'psyker';
  second.nodes.forEach(node => { node.skill_id = null; });
  duplicateAcrossTrees.talent_trees.push(second);
  assert.doesNotThrow(() => validatePublishedContent(duplicateAcrossTrees), 'node IDs are local to each tree');
});

// Scenario: Generated tree files or catalog metadata are altered after generation.
// Purpose: Revalidate every tree, exact source list, canonical skill detail, and tree file path at the public boundary.
test('InterT01_rejects_tampered_tree_rows_metadata_sources_and_details', () => {
  const files = createPublicFiles(treeModel());
  const corruptions = [
    ['tree metadata node count', copy => {
      const catalog = readJson(copy, 'catalog.json');
      catalog.talent_trees[0].node_count++;
      writeJson(copy, 'catalog.json', catalog);
    }, /node_count|node count/u],
    ['catalog tree path', copy => {
      const catalog = readJson(copy, 'catalog.json');
      catalog.talent_trees[0].tree_path = 'trees/../veteran.json';
      writeJson(copy, 'catalog.json', catalog);
    }, /tree_path|path/u],
    ['extra catalog tree metadata field', copy => {
      const catalog = readJson(copy, 'catalog.json');
      catalog.talent_trees[0].private_note = 'x';
      writeJson(copy, 'catalog.json', catalog);
    }, /unknown or unsupported field/u],
    ['extra tree output field', copy => {
      const tree = readJson(copy, 'trees/veteran.json');
      tree.private_note = 'x';
      writeJson(copy, 'trees/veteran.json', tree);
    }, /unknown or unsupported field/u],
    ['tree row dangling child', copy => {
      const tree = readJson(copy, 'trees/veteran.json');
      tree.nodes[0].children = ['missing-node'];
      writeJson(copy, 'trees/veteran.json', tree);
    }, /child.*unknown|unknown.*child/u],
    ['tree sources mismatch', copy => {
      const tree = readJson(copy, 'trees/veteran.json');
      tree.source_ids = [];
      writeJson(copy, 'trees/veteran.json', tree);
    }, /source/u],
    ['tree source conflicts with canonical detail metadata', copy => {
      const tree = readJson(copy, 'trees/veteran.json');
      tree.source_ids = ['skill-source'];
      tree.sources = [{ source_id: 'skill-source', label: 'Changed label', url: 'https://example.com/changed' }];
      writeJson(copy, 'trees/veteran.json', tree);
    }, /source metadata conflicts/u],
    ['tree detail differs from canonical skill detail', copy => {
      const tree = readJson(copy, 'trees/veteran.json');
      tree.details[0].record.effect_zh_tw = 'tampered';
      writeJson(copy, 'trees/veteran.json', tree);
    }, /detail.*canonical|skill detail/u],
    ['extra tree output file', copy => { copy.set('trees/psyker.json', '{}\n'); }, /missing or unreferenced files/u]
  ];
  for (const [label, corrupt, expected] of corruptions) {
    const copy = new Map(files);
    corrupt(copy);
    assert.throws(() => validatePublicFiles(copy), expected, label);
  }
  const missingTree = new Map(files);
  missingTree.delete('trees/veteran.json');
  assert.throws(() => validatePublicFiles(missingTree), /missing/u, 'catalogued tree file is required');
});