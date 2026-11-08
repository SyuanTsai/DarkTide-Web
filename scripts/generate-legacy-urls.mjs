import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const GENERATOR_VERSION = '1.0.0';
export const SOURCE_COMMIT = '93185bf9c070da578701fa398e85da9a08b8d4c4';
const TARGET_VERSION = '1.13.4';
const classes = { arbites: 'adamant', scum: 'broker', skitarii: 'cryptic', veteran: 'veteran', zealot: 'zealot', psyker: 'psyker', ogryn: 'ogryn' };
const categories = ['skills', 'weapons', 'blessings', 'terms'];
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const sorted = object => Object.fromEntries(Object.entries(object).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0));

// Pure and offline: callers supply all source documents, never URLs to fetch.
export function generateLegacyUrls({ migration, onlineSkills, retainedIndex, retainedContent, sourceData, sources = {} }) {
  const ids = {}, paths = {}, familyPaths = {}, unmapped = [];
  const items = category => sourceData[category].items;
  const targetIds = Object.fromEntries(categories.map(category => [category, new Set(items(category).map(i => i.id))]));
  const put = (table, old, target) => {
    if (Object.hasOwn(table, old) && table[old] !== target) throw new Error(`mapping conflict: ${old}`);
    table[old] = target;
  };
  const missing = (kind, value, category, reason, candidates = []) => {
    if (!unmapped.some(row => row.kind === kind && row.value === value)) unmapped.push({ kind, value, category, reason, ...(candidates.length ? { candidates: [...new Set(candidates)].sort() } : {}) });
  };
  const assign = (table, old, category, candidates, reason) => {
    const unique = [...new Set(candidates)];
    const available = unique.filter(id => targetIds[category]?.has(id));
    if (unique.length === 1 && available.length === 1) put(table, old, available[0]);
    else missing(table === ids ? 'id' : 'path', old, category, unique.length > 1 ? 'ambiguous-targets' : reason, unique);
  };
  for (const row of migration.items) {
    if (!targetIds[row.category]) throw new Error(`unknown migration category: ${row.category}`);
    assign(ids, row.onlineId, row.category, [row.id], 'target-not-in-1.13.4');
  }
  for (const row of onlineSkills.source.records.filter(r => r.kind === 'skill')) {
    const archetype = classes[row.recordId.split(':')[2]];
    const candidates = items('skills').filter(item => archetype && item.values?.archetype === archetype && typeof row.payload.nameKey === 'string' && item.source?.text?.keys?.name === row.payload.nameKey);
    assign(ids, row.recordId, 'skills', candidates.map(i => i.id), 'missing-class-nameKey');
  }
  const indexedSkills = retainedIndex.entries.filter(e => e.kind === 'skill');
  const indexedIds = new Set(indexedSkills.map(e => e.id));
  const additionalSkills = retainedContent.routes.filter(r => r.route_kind === 'canonical' && r.content_kind === 'skill' && !indexedIds.has(r.content_key)).map(r => ({ id: r.content_key }));
  for (const row of [...indexedSkills, ...additionalSkills]) {
    const [oldClass, key, extra] = row.id.split('/');
    const retained = retainedContent.skills.find(i => i.archetype === oldClass && i.skill_id === key);
    const route = `/skills/${row.id}/`;
    if (!retained || extra || !retainedContent.routes.some(r => r.route_kind === 'canonical' && r.content_kind === 'skill' && r.content_key === row.id && r.target_route === route)) throw new Error(`unverified retained skill route: ${route}`);
    const candidates = items('skills').filter(i => classes[oldClass] && i.key === key && i.values?.archetype === classes[oldClass]);
    assign(paths, route, 'skills', candidates.map(i => i.id), `missing-class-key:${retained.kind}${indexedIds.has(row.id) ? '' : ':not-in-player-index'}`);
  }
  // Retained weapon marks and blessing variants carry the actual internal keys.
  // A blessing group is migratable only when its variant set identifies one item.
  for (const route of retainedContent.routes.filter(r => r.route_kind === 'canonical')) {
    if (route.content_kind === 'mark') {
      const old = retainedContent.marks.find(i => i.mark_id === route.content_key);
      const matches = items('weapons').filter(i => i.key === old?.mark_id && i.values?.family === old.weapon_id);
      assign(paths, route.target_route, 'weapons', matches.map(i => i.id), 'missing-mark-key');
    } else if (route.content_kind === 'weapon') {
      const family = route.content_key;
      if (items('weapons').some(i => i.values?.family === family)) put(familyPaths, route.target_route, family);
      else missing('path', route.target_route, 'weapons', 'missing-family');
    } else if (route.content_kind === 'variant') {
      const matches = items('blessings').filter(i => i.key === route.content_key);
      assign(paths, route.target_route, 'blessings', matches.map(i => i.id), 'missing-variant-key');
    } else if (route.content_kind === 'blessing') {
      const old = retainedContent.blessings.find(i => i.blessing_id === route.content_key);
      const matches = items('blessings').filter(i => old?.variant_ids.includes(i.key));
      // A partial set must not collapse a historical group to an arbitrary survivor.
      const allPresent = old?.variant_ids.every(key => matches.some(i => i.key === key));
      if (!allPresent) missing('path', route.target_route, 'blessings', 'missing-group-variant');
      else assign(paths, route.target_route, 'blessings', matches.map(i => i.id), 'missing-group-variant');
    }
  }
  for (const [old, target] of Object.entries(ids)) {
    // An unchanged id (the terminology row) is terminal and needs no rewrite.
    if (old !== target && Object.hasOwn(ids, target) && ids[target] !== target) throw new Error(`mapping chain or cycle: ${old}`);
    if (unmapped.some(r => r.kind === 'id' && r.value === old)) throw new Error(`mapped/unmapped conflict: ${old}`);
  }
  for (const row of unmapped) if (row.kind === 'path' && (Object.hasOwn(paths, row.value) || Object.hasOwn(familyPaths, row.value))) throw new Error(`mapped/unmapped conflict: ${row.value}`);
  return { schemaVersion: 1, generatorVersion: GENERATOR_VERSION, targetVersion: TARGET_VERSION, sources, ids: sorted(ids), paths: sorted(paths), familyPaths: sorted(familyPaths), unmapped: unmapped.sort((a, b) => a.value < b.value ? -1 : a.value > b.value ? 1 : 0) };
}

export function runtimeModule(map) {
  const compact = { targetVersion: map.targetVersion, ids: map.ids, paths: map.paths, familyPaths: map.familyPaths };
  return `// Generated by scripts/generate-legacy-urls.mjs@${GENERATOR_VERSION}; do not edit.\nexport default ${JSON.stringify(compact)};\n`;
}

async function main(args) {
  const options = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--check') options.check = true;
    else if (['--migration-map', '--online-snapshot', '--source-data'].includes(args[i]) && args[i + 1]) options[args[i].slice(2)] = path.resolve(args[++i]);
    else throw new Error('Usage: generate-legacy-urls.mjs --migration-map file --online-snapshot directory --source-data checkout [--check]');
  }
  if (!['migration-map', 'online-snapshot', 'source-data'].every(key => options[key])) throw new Error('Missing generation inputs');
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const sourceRoot = options['source-data'];
  if (execFileSync('git', ['-C', sourceRoot, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim() !== SOURCE_COMMIT) throw new Error('Source-Data HEAD must equal ' + SOURCE_COMMIT);
  const read = async file => { const bytes = await readFile(file); return { value: JSON.parse(bytes), sha256: sha256(bytes) }; };
  const migration = await read(options['migration-map']);
  const onlineDir = options['online-snapshot'];
  const version = await read(path.join(onlineDir, 'version.json'));
  const manifest = await read(path.join(onlineDir, 'manifest.json'));
  const onlineSkills = await read(path.join(onlineDir, 'skills.json'));
  const pointer = version.value.game_releases.find(p => p.game_version === version.value.game_version);
  const descriptor = manifest.value.files.find(f => f.kind === 'skills');
  if (pointer.manifest_sha256 !== manifest.sha256 || pointer.data_revision !== manifest.value.dataRevision || descriptor.sha256 !== onlineSkills.sha256 || descriptor.sizeBytes !== (await readFile(path.join(onlineDir, 'skills.json'))).length) throw new Error('Online snapshot pins do not match');
  const retainedIndex = await read(path.join(root, 'content/history/1.13.1/player-index.json'));
  const retainedContent = await read(path.join(root, 'content/history/1.13.1/source-content.json'));
  const sourceData = {}, sourceHashes = {};
  for (const category of categories) {
    const input = await read(path.join(sourceRoot, 'data', TARGET_VERSION, category + '.json'));
    sourceData[category] = input.value; sourceHashes[category] = input.sha256;
  }
  const sources = {
    migrationMap: { path: 'DarkTide-Pipeline-Work/migration/syp-391-v3/migration-map.json', sha256: migration.sha256 },
    online: { versionUrl: 'https://darktide.tw-syuan.com/version.json', versionSha256: version.sha256, manifestPath: pointer.manifest_path, manifestSha256: manifest.sha256, skillsPath: `/data/${pointer.data_revision}/${descriptor.path}`, skillsSha256: onlineSkills.sha256 },
    retainedIndex: { path: 'content/history/1.13.1/player-index.json', sha256: retainedIndex.sha256 },
    retainedContent: { path: 'content/history/1.13.1/source-content.json', sha256: retainedContent.sha256 },
    sourceData: { commit: SOURCE_COMMIT, gameVersion: TARGET_VERSION, sha256: sourceHashes }
  };
  const map = generateLegacyUrls({ migration: migration.value, onlineSkills: onlineSkills.value, retainedIndex: retainedIndex.value, retainedContent: retainedContent.value, sourceData, sources });
  const inventory = { commit: SOURCE_COMMIT, gameVersion: TARGET_VERSION, sha256: sourceHashes,
    categories: Object.fromEntries(categories.map(c => [c, sourceData[c].items.map(i => i.id).sort()])),
    skillIdentities: sourceData.skills.items.map(i => [i.id, i.values.archetype, i.key, i.source.text.keys.name]),
    weaponFamilies: [...new Set(sourceData.weapons.items.map(i => i.values.family))].sort()
  };
  const selectedSkills = ['psyker_brain_burst_improved', 'adamant_ammo_belt', 'adamant_area_buff_drone_improved'];
  const selectedBlessing = 'weapon_trait_bespoke_arc_rifle_p1_ammo_from_reserve_on_crit';
  const details = [{ kind: 'skills', document: { schemaVersion: sourceData.skills.schemaVersion, items: sourceData.skills.items.filter(i => selectedSkills.includes(i.key)) } }, { kind: 'blessing', document: { schemaVersion: sourceData.blessings.schemaVersion, items: sourceData.blessings.items.filter(i => i.key === selectedBlessing) } }];
  const missingDoc = '# 舊網址 unmapped 清單（自動產生）\n\n每筆均顯示「找不到」，不回退列表。`missing-class-key:base-effect` 表示 1.13.1 的基礎效果在 1.13.4 skills 中沒有相同 class/key；`ambiguous-targets` 表示舊祝福群組包含多個新實體；其他 missing 原因表示指定內部 key 在目標資料不存在。\n\n| 類別 | 舊網址 | 原因 | 候選數 |\n|---|---|---|---:|\n' + map.unmapped.map(r => `| ${r.category} | \`${r.value}\` | ${r.reason} | ${r.candidates?.length ?? 0} |`).join('\n') + '\n';
  const outputs = [
    ['content/compatibility/legacy-urls.json', JSON.stringify(map, null, 2) + '\n'],
    ['web/legacy-url-map.mjs', runtimeModule(map)],
    ['test/fixtures/legacy-url-targets.json', JSON.stringify(inventory, null, 2) + '\n'],
    ['test/fixtures/legacy-url-details.json', JSON.stringify(details, null, 2) + '\n'],
    ['docs/contracts/legacy-url-unmapped.md', missingDoc]
  ];
  for (const [relative, text] of outputs) {
    const destination = path.join(root, relative);
    if (options.check) { if (!(await readFile(destination)).equals(Buffer.from(text))) throw new Error('Generated output differs: ' + relative); }
    else { await mkdir(path.dirname(destination), { recursive: true }); await writeFile(destination, text); }
  }
  console.log(JSON.stringify({ ids: Object.keys(map.ids).length, paths: Object.keys(map.paths).length, familyPaths: Object.keys(map.familyPaths).length, unmapped: map.unmapped.length, reasons: Object.fromEntries(Object.entries(Object.groupBy(map.unmapped, r => r.reason)).map(([k,v]) => [k,v.length])), check: !!options.check }));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1; });
}
