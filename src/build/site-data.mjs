import { jsonBytes, sha256, safeRelativePath, compareUtf8 } from '../static/common.mjs';
import { buildGameChangesDomain } from './game-changes.mjs';
// Same per-file limit as scripts/content/contract-release.mjs (MAX_DOMAIN_BYTES).
export const MAX_DOMAIN_BYTES = 16 * 1024 * 1024;
const slug = value => { const result = encodeURIComponent(value).replaceAll('%', '_'); return result; };

export function buildSiteData({ source, announcements = null, frozen = {} }) {
  const files = new Map(); const pointers = [];
  for (const gameVersion of source.current.versions) {
    const data = source.dataByVersion[gameVersion];
    const domains = new Map(); const rows = [];
    const add = (kind, path, value, dependencies = []) => {
      safeRelativePath(path, 'Source-Data domain');
      const bytes = jsonBytes(value);
      if (bytes.length > MAX_DOMAIN_BYTES) throw new Error(`${path} exceeds ${MAX_DOMAIN_BYTES} bytes`);
      if (domains.has(path)) throw new Error(`duplicate domain path ${path}`);
      domains.set(path, bytes); rows.push({ kind, path, sizeBytes: bytes.length, sha256: sha256(bytes), dependencies });
    };
    for (const category of ['skills', 'terms']) add(category, `domains/${category}.json`, data[category]);
    const index = (item, path) => ({ id: item.id, name: item.name, ...(item.values.family ? { family: item.values.family, mark: item.values.mark } : {}), path });
    const weaponIndex = [];
    for (const family of [...new Set(data.weapons.items.map(item => item.values.family))].sort(compareUtf8)) {
      const items = data.weapons.items.filter(item => item.values.family === family);
      const path = `domains/weapons/${slug(family)}.json`;
      add('weapon-family', path, { ...data.weapons, items });
      weaponIndex.push(...items.map(item => index(item, path)));
    }
    add('weapons-index', 'domains/weapons-index.json', { gameVersion, category: 'weapons-index', items: weaponIndex });
    // The existing W08 split uses one blessing record per shard.
    const blessingIndex = [];
    for (const item of data.blessings.items) {
      const path = `domains/blessings/${slug(item.id)}.json`;
      add('blessing', path, { ...data.blessings, items: [item] }); blessingIndex.push(index(item, path));
    }
    add('blessings-index', 'domains/blessings-index.json', { gameVersion, category: 'blessings-index', items: blessingIndex });
    if (announcements) add('announcements', 'domains/announcements.json', announcements);
    const changes = buildGameChangesDomain({ versions: source.current.versions, dataByVersion: source.dataByVersion, gameVersion, frozen: frozen[gameVersion] });
    if (changes) add('game-changes', 'domains/game-changes.json', changes);
    rows.sort((a, b) => compareUtf8(a.path, b.path));
    const material = { schemaVersion: '3.0.0', gameVersion, source: { repository: 'SyuanTsai/DarkTide-Source-Data', commit: source.commit, dataSchemaVersion: data.skills.schemaVersion, textBatch: data.skills.textBatch }, files: rows };
    const dataRevision = sha256(jsonBytes(material));
    const manifest = { ...material, dataRevision };
    const manifestBytes = jsonBytes(manifest);
    const prefix = `data/${dataRevision}/`;
    for (const [name, bytes] of domains) files.set(prefix + name, bytes);
    files.set(prefix + 'manifest.json', manifestBytes);
    pointers.push({ game_version: gameVersion, data_revision: dataRevision, manifest_path: `/${prefix}manifest.json`, manifest_sha256: sha256(manifestBytes) });
  }
  for (const [name, bytes] of source.rawFiles) files.set(`source-data/${name}`, bytes);
  return { files, pointers, current: pointers.find(p => p.game_version === source.current.gameVersion) };
}
